import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { dayOf, weekOf, weekStart } from '../common/week.js';
import { Save } from '../saves/save.schema.js';
import { PERSON_FIELDS, toPerson, type PersonDto } from '../users/person.js';
import { User } from '../users/user.schema.js';
import { BossLog, BossPlayer, BossWeek, type BossPlayerDocument, type BossWeekDocument } from './boss.schema.js';
import type { BossClaimDto, BossContributorDto, BossDto, BossHitBodyDto, BossHitResultDto, BossInfoDto, BossLastDto } from './dto/boss.dto.js';
import { DAILY_HITS, MIN_GAP_MS, TIER_REWARDS, bossOf, hitDamage, isBossKind, rankReward, targetOf, tierOf, tierRewardSum, type BossDef, type BossKind } from './roster.js';

const DAY_MS = 24 * 3600_000;
const WEEK_MS = 7 * DAY_MS;
/** 목표를 정할 때 "활성 계정"으로 치는 기간 */
const ACTIVE_MS = 7 * DAY_MS;
export const BOSS_TOP_SIZE = 10;
export const BOSS_FEED_SIZE = 10;

const isDuplicate = (e: unknown): boolean => (e as { code?: number }).code === 11000;
const infoOf = (b: BossDef): BossInfoDto => ({ id: b.id, name: b.name, icon: b.icon, line: b.line, weak: b.weak });

@Injectable()
export class BossService {
  constructor(
    @InjectModel(BossWeek.name) private readonly weeks: Model<BossWeek>,
    @InjectModel(BossPlayer.name) private readonly players: Model<BossPlayer>,
    @InjectModel(BossLog.name) private readonly logs: Model<BossLog>,
    @InjectModel(Save.name) private readonly saves: Model<Save>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** 그 주의 기록. 없으면 지난주 총합과 활성 계정 수로 목표를 정해 만든다. */
  private async weekDoc(week: number, now: number): Promise<BossWeekDocument> {
    const found = await this.weeks.findOne({ week }).exec();
    if (found) return found;
    const prev = await this.weeks.findOne({ week: week - 1 }).exec();
    const active = await this.saves.countDocuments({ savedAt: { $gt: now - ACTIVE_MS } }).exec();
    try {
      return await this.weeks.create({ week, bossId: bossOf(week).id, target: targetOf(prev?.total ?? 0, active), total: 0, players: 0 });
    } catch (e) {
      if (isDuplicate(e)) return this.weeks.findOne({ week }).orFail().exec(); // 동시에 다른 요청이 먼저 만들었다
      throw e;
    }
  }

  /** 끝난 판 하나를 보스에게 반영한다. 같은 판(runId)은 한 번만, 하루 DAILY_HITS타까지, 타 사이 MIN_GAP_MS 간격으로만 센다. */
  async hit(user: UserDto, body: Partial<BossHitBodyDto> | undefined, now = Date.now()): Promise<BossHitResultDto> {
    const kind = body?.kind;
    const score = body?.score;
    const runId = body?.runId;
    if (!isBossKind(kind)) throw new BadRequestException('판의 종류가 올바르지 않아요.');
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1000) throw new BadRequestException('점수가 올바르지 않아요.');
    if (typeof runId !== 'string' || runId.length < 1 || runId.length > 64) throw new BadRequestException('판 번호가 올바르지 않아요.');

    const week = weekOf(now);
    const doc = await this.weekDoc(week, now);
    const boss = bossOf(week);
    const { damage, weak, crit } = hitDamage(kind, score, boss.weak);
    const base = { weak, crit, bossName: boss.name, total: doc.total, target: doc.target, tier: tierOf(doc.total, doc.target) };
    const skipped = (reason: NonNullable<BossHitResultDto['reason']>): BossHitResultDto => ({ ...base, counted: false, damage: 0, reason });
    if (damage < 1) return skipped('no_damage');

    const uid = new Types.ObjectId(user.id);
    const today = dayOf(now);
    // 같은 판이 다시 들어오면(재시도) 여기서 걸러진다.
    try {
      await this.logs.create({ userId: uid, runId, week, kind, damage });
    } catch (e) {
      if (isDuplicate(e)) return skipped('duplicate');
      throw e;
    }
    await this.players
      .updateOne({ week, userId: uid }, { $setOnInsert: { damage: 0, hits: 0, dayKey: '', dayHits: 0, lastHitAt: 0, claimedTiers: 0, rankClaimed: false } }, { upsert: true })
      .exec();
    const gap = { lastHitAt: { $lte: now - MIN_GAP_MS } };
    // 오늘 이미 센 날이면 상한 아래일 때만, 새 날이면 오늘 첫 타로 센다. 조건이 문서에 걸려 있어서 동시에 와도 상한을 넘지 못한다.
    let before: BossPlayerDocument | null = await this.players
      .findOneAndUpdate({ week, userId: uid, dayKey: today, dayHits: { $lt: DAILY_HITS }, ...gap }, { $inc: { damage, hits: 1, dayHits: 1 }, $set: { lastHitAt: now } }, { returnDocument: 'before' })
      .exec();
    if (!before) {
      before = await this.players
        .findOneAndUpdate({ week, userId: uid, dayKey: { $ne: today }, ...gap }, { $inc: { damage, hits: 1 }, $set: { dayKey: today, dayHits: 1, lastHitAt: now } }, { returnDocument: 'before' })
        .exec();
    }
    if (!before) {
      await this.logs.deleteOne({ userId: uid, runId }).exec();
      const me = await this.players.findOne({ week, userId: uid }).exec();
      return skipped(me && me.dayKey === today && me.dayHits >= DAILY_HITS ? 'daily_cap' : 'too_fast');
    }
    const updated = await this.weeks.findOneAndUpdate({ week }, { $inc: { total: damage, ...(before.hits === 0 ? { players: 1 } : {}) } }, { returnDocument: 'after' }).exec();
    const total = updated?.total ?? doc.total + damage;
    return { ...base, counted: true, damage, reason: null, total, tier: tierOf(total, doc.target) };
  }

  async overview(user: UserDto, now = Date.now()): Promise<BossDto> {
    const week = weekOf(now);
    const doc = await this.weekDoc(week, now);
    const boss = bossOf(week);
    const uid = new Types.ObjectId(user.id);
    const [me, topDocs, feedDocs, lastDoc, lastMe] = await Promise.all([
      this.players.findOne({ week, userId: uid }).exec(),
      this.players.find({ week, damage: { $gt: 0 } }).sort({ damage: -1, _id: 1 }).limit(BOSS_TOP_SIZE).exec(),
      this.logs.find({ week }).sort({ createdAt: -1 }).limit(BOSS_FEED_SIZE).exec(),
      this.weeks.findOne({ week: week - 1 }).exec(),
      this.players.findOne({ week: week - 1, userId: uid }).exec(),
    ]);
    const meOutside = me && me.damage > 0 && !topDocs.some((d) => String(d._id) === String(me._id));
    const people = await this.people([...topDocs.map((d) => d.userId), ...feedDocs.map((d) => d.userId), ...(meOutside ? [me.userId] : [])]);
    const person = (id: Types.ObjectId): PersonDto | undefined => people.get(String(id));

    const contributor = (d: BossPlayerDocument, rank: number): BossContributorDto => {
      const p = person(d.userId);
      return { rank, uid: String(d.userId), name: p?.name ?? '익명', picture: p?.picture ?? null, avatar: p?.avatar ?? 'google', damage: d.damage, me: String(d.userId) === user.id };
    };

    const tier = tierOf(doc.total, doc.target);
    const claimedTiers = me?.claimedTiers ?? 0;
    const mineEntry = meOutside ? contributor(me, await this.rankOf(week, me)) : null;

    let last: BossLastDto | null = null;
    if (lastDoc) {
      const played = !!lastMe && lastMe.hits >= 1;
      const myRank = played ? await this.rankOf(week - 1, lastMe) : null;
      const reward = played && !lastMe.rankClaimed && myRank ? rankReward(myRank, lastDoc.players) : 0;
      last = {
        boss: infoOf(bossOf(week - 1)),
        target: lastDoc.target,
        total: lastDoc.total,
        cleared: lastDoc.total >= lastDoc.target,
        myDamage: lastMe?.damage ?? 0,
        myRank,
        reward: reward > 0 ? reward : null,
        claimed: !!lastMe?.rankClaimed,
      };
    }

    return {
      week,
      endsAt: weekStart(week) + WEEK_MS,
      boss: infoOf(boss),
      target: doc.target,
      total: doc.total,
      tier,
      tierRewards: [...TIER_REWARDS],
      claimedTiers,
      claimable: me && me.hits >= 1 ? tierRewardSum(claimedTiers, tier) : 0,
      myDamage: me?.damage ?? 0,
      myHits: me?.hits ?? 0,
      todayHits: me && me.dayKey === dayOf(now) ? me.dayHits : 0,
      dailyCap: DAILY_HITS,
      players: doc.players,
      top: topDocs.map((d, i) => contributor(d, i + 1)),
      mine: mineEntry,
      feed: feedDocs.map((d) => ({ name: person(d.userId)?.name ?? '익명', kind: (isBossKind(d.kind) ? d.kind : 'concert') as BossKind, damage: d.damage, at: d.createdAt.getTime() })),
      last,
    };
  }

  /** 이번 주 단계 보상을 닿은 단계까지 한 번에 받는다. 받은 단계를 원자적으로 올려서 같은 단계는 한 번만 나간다. */
  async claim(user: UserDto, now = Date.now()): Promise<BossClaimDto> {
    const week = weekOf(now);
    const doc = await this.weekDoc(week, now);
    const tier = tierOf(doc.total, doc.target);
    const before = await this.players
      .findOneAndUpdate({ week, userId: new Types.ObjectId(user.id), hits: { $gte: 1 }, claimedTiers: { $lt: tier } }, { $set: { claimedTiers: tier } }, { returnDocument: 'before' })
      .exec();
    if (!before) throw new ConflictException('받을 보상이 없어요.');
    return { diamonds: tierRewardSum(before.claimedTiers, tier), label: `${bossOf(week).name} ${tier}단계 보상` };
  }

  /** 지난주 개인 순위 보상을 한 번만 받는다. */
  async claimLast(user: UserDto, now = Date.now()): Promise<BossClaimDto> {
    const last = weekOf(now) - 1;
    const uid = new Types.ObjectId(user.id);
    const [lastDoc, me] = await Promise.all([this.weeks.findOne({ week: last }).exec(), this.players.findOne({ week: last, userId: uid }).exec()]);
    if (!lastDoc || !me || me.hits < 1) throw new NotFoundException('받을 보상이 없어요.');
    if (me.rankClaimed) throw new ConflictException('이미 받았어요.');
    const rank = await this.rankOf(last, me);
    const reward = rankReward(rank, lastDoc.players);
    if (reward < 1) throw new NotFoundException('받을 보상이 없어요.');
    const taken = await this.players.findOneAndUpdate({ _id: me._id, rankClaimed: false }, { $set: { rankClaimed: true } }, { returnDocument: 'after' }).exec();
    if (!taken) throw new ConflictException('이미 받았어요.');
    return { diamonds: reward, label: `지난주 ${bossOf(last).name} ${rank}위 보상` };
  }

  /** 받을 수 있는 보상 묶음 수(이번 주 단계 + 지난주 순위). 알림 점에 쓰니 주 기록을 새로 만들지 않는다. */
  async claimableCount(userId: string, now = Date.now()): Promise<number> {
    const week = weekOf(now);
    const uid = new Types.ObjectId(userId);
    const [cur, me, lastDoc, lastMe] = await Promise.all([
      this.weeks.findOne({ week }).exec(),
      this.players.findOne({ week, userId: uid }).exec(),
      this.weeks.findOne({ week: week - 1 }).exec(),
      this.players.findOne({ week: week - 1, userId: uid }).exec(),
    ]);
    let n = 0;
    if (cur && me && me.hits >= 1 && tierRewardSum(me.claimedTiers, tierOf(cur.total, cur.target)) > 0) n++;
    if (lastDoc && lastMe && lastMe.hits >= 1 && !lastMe.rankClaimed && rankReward(await this.rankOf(week - 1, lastMe), lastDoc.players) > 0) n++;
    return n;
  }

  /** 그 주 안에서의 순위(1부터): 데미지가 클수록, 같으면 먼저 때린 쪽이 앞선다. */
  private async rankOf(week: number, p: BossPlayerDocument): Promise<number> {
    const ahead = await this.players.countDocuments({ week, $or: [{ damage: { $gt: p.damage } }, { damage: p.damage, _id: { $lt: p._id } }] }).exec();
    return ahead + 1;
  }

  private async people(ids: Types.ObjectId[]): Promise<Map<string, PersonDto>> {
    const unique = [...new Set(ids.map(String))].map((i) => new Types.ObjectId(i));
    const users = await this.users.find({ _id: { $in: unique } }, PERSON_FIELDS).exec();
    const now = Date.now();
    return new Map(users.map((u) => [String(u._id), toPerson(u, now)]));
  }
}

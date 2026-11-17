import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { dayOf } from '../common/week.js';
import { Save } from '../saves/save.schema.js';
import { User } from '../users/user.schema.js';
import { AwardClaim, AwardEdition, AwardPoint, AwardVote } from './awards.schema.js';
import type { AwardBallotDto, AwardClaimDto, AwardItemDto, AwardResultDto, AwardRowDto, AwardStandingDto, AwardsDto } from './dto/awards.dto.js';
import {
  AWARD_CATEGORIES,
  AWARD_YEAR,
  SCORE_CATEGORIES,
  STANDINGS_TOP,
  VOTE_CATEGORIES,
  VOTE_MIN_ACCOUNT_DAYS,
  VOTE_MIN_FANS,
  candidatesOf,
  claimItemsOf,
  firstSingleAt,
  isRookie,
  isVoteCategory,
  phaseOf,
  rankScores,
  resultsOf,
  rewardFor,
  scheduleOf,
  tallyKey,
  voteGate,
  type CandidateRow,
  type RankedSong,
  type ResultRow,
  type ScoreCategory,
  type SongTotal,
  type VoteGate,
} from './rules.js';

/** 중간 순위를 다시 계산하는 간격(집계는 정시마다만 바뀌므로 자주 할 필요가 없다) */
const STANDINGS_CACHE_MS = 5 * 60_000;

const BLOCKED_TEXT: Record<Exclude<VoteGate, null>, string> = {
  young: `가입한 지 ${VOTE_MIN_ACCOUNT_DAYS}일이 지난 계정만 투표할 수 있어요.`,
  fans: `팬이 ${VOTE_MIN_FANS.toLocaleString('ko-KR')}명 이상이어야 투표할 수 있어요.`,
};

/**
 * 시상식 화면·투표·보상. 집계(`AwardsService`)가 쌓은 `award_points`를 읽어 부문별 순위를 만들고, 후보·결과를 `award_editions`에 한 번만 적어 둔다.
 * 순위·후보·결과·보상 목록을 가리는 규칙은 모두 `rules.ts`의 순수 함수다. 이 서비스는 DB를 읽고 쓰는 일만 맡는다.
 */
@Injectable()
export class AwardsBoardService {
  private readonly period = String(AWARD_YEAR);
  private cache: { at: number; ranks: Record<ScoreCategory, RankedSong[]> } | null = null;

  constructor(
    @InjectModel(AwardPoint.name) private readonly points: Model<AwardPoint>,
    @InjectModel(AwardEdition.name) private readonly editions: Model<AwardEdition>,
    @InjectModel(AwardVote.name) private readonly votes: Model<AwardVote>,
    @InjectModel(AwardClaim.name) private readonly claims: Model<AwardClaim>,
    @InjectModel(Save.name) private readonly saves: Model<Save>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /* ---------- 확정 자료 ---------- */

  /**
   * 단계에 맞는 확정 자료를 만들어 둔다: 투표 단계부터 후보, 발표 단계부터 결과. 이미 있으면 읽기만 한다.
   * 집계 타이머가 5분마다 부르고, 화면·청구 요청도 부르므로 누가 먼저든 같은 값이 한 번만 적힌다.
   */
  async freeze(now = Date.now()): Promise<void> {
    const phase = phaseOf(now);
    if (phase === 'collecting') return;
    const candidates = await this.ensureCandidates();
    if (phase !== 'voting') await this.ensureResults(candidates);
  }

  /** 후보: 투표 시작 전날까지의 누적으로 가린다(언제 처음 계산하든 같다). 계산 결과가 비어 있으면 적지 않는다. */
  private async ensureCandidates(): Promise<CandidateRow[]> {
    const doc = await this.editions.findOne({ period: this.period }).lean().exec();
    if (doc?.candidates && doc.candidates.length > 0) return doc.candidates;
    const s = scheduleOf();
    const candidates = candidatesOf(await this.totals(s.fromDay, s.candidatesDay));
    if (candidates.length === 0) return [];
    await this.setOnce('candidates', candidates);
    return (await this.editions.findOne({ period: this.period }).lean().exec())?.candidates ?? candidates;
  }

  /** 결과: 해 전체 누적과 투표를 모아 발표 때 한 번 계산한다. 비어 있으면 적지 않는다. */
  private async ensureResults(candidates: readonly CandidateRow[]): Promise<ResultRow[]> {
    const doc = await this.editions.findOne({ period: this.period }).lean().exec();
    if (doc?.results && doc.results.length > 0) return doc.results;
    const s = scheduleOf();
    const totals = await this.totals(s.fromDay, s.toDay);
    const rookies = await this.rookieUids(totals, s.rookieFrom);
    const tallies = await this.tallies();
    const results = resultsOf(totals, rookies, candidates, tallies);
    if (results.length === 0) return [];
    await this.setOnce('results', results);
    return (await this.editions.findOne({ period: this.period }).lean().exec())?.results ?? results;
  }

  /** 값이 아직 null인 칸에만 적는다(먼저 적은 쪽이 이긴다). 문서가 없으면 만든다. */
  private async setOnce(field: 'candidates' | 'results', value: CandidateRow[] | ResultRow[]): Promise<void> {
    try {
      await this.editions.updateOne({ period: this.period }, { $setOnInsert: { period: this.period, createdAt: new Date() } }, { upsert: true }).exec();
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // 동시에 다른 요청이 만들었다
    }
    await this.editions.updateOne({ period: this.period, [field]: null }, { $set: { [field]: value } }).exec();
  }

  /** 기간 안의 곡별 누적(속성·곡마다). 활동명·제목은 가장 늦은 날의 것이다. */
  private async totals(fromDay: string, toDay: string): Promise<SongTotal[]> {
    const rows = await this.points
      .aggregate<{ _id: { persona: SongTotal['persona']; key: string }; uid: string; title: string; artist: string; points: number; hours: number; revivals: number }>([
        { $match: { day: { $gte: fromDay, $lte: toDay } } },
        { $sort: { day: 1 } },
        {
          $group: {
            _id: { persona: '$persona', key: '$key' },
            uid: { $last: '$uid' },
            title: { $last: '$title' },
            artist: { $last: '$artist' },
            points: { $sum: '$points' },
            hours: { $sum: '$hours' },
            revivals: { $sum: '$revivals' },
          },
        },
      ])
      .allowDiskUse(true)
      .exec();
    return rows.map((r) => ({ persona: r._id.persona, key: r._id.key, uid: r.uid, title: r.title, artist: r.artist, points: r.points, hours: r.hours, revivals: r.revivals }));
  }

  /** 신인 계정 ID들: 누적에 이름이 있는 계정 중 첫 싱글이 `rookieFrom` 이후인 계정 */
  private async rookieUids(totals: readonly SongTotal[], rookieFrom: number): Promise<Set<string>> {
    const uids = [...new Set(totals.map((t) => t.uid))].filter((u) => Types.ObjectId.isValid(u));
    if (uids.length === 0) return new Set();
    const docs = (await this.saves
      .find({ userId: { $in: uids.map((u) => new Types.ObjectId(u)) } }, { userId: 1, 'state.singles.releasedAt': 1 })
      .lean()
      .exec()) as unknown as { userId: Types.ObjectId; state?: unknown }[];
    const out = new Set<string>();
    for (const d of docs) if (isRookie(firstSingleAt(d.state), rookieFrom)) out.add(String(d.userId));
    return out;
  }

  private async tallies(): Promise<Map<string, number>> {
    const rows = await this.votes.aggregate<{ _id: { category: string; key: string }; n: number }>([{ $match: { period: this.period } }, { $group: { _id: { category: '$category', key: '$key' }, n: { $sum: 1 } } }]).exec();
    const map = new Map<string, number>();
    for (const r of rows) if (isVoteCategory(r._id.category)) map.set(tallyKey(r._id.category, r._id.key), r.n);
    return map;
  }

  /* ---------- 중간 순위 ---------- */

  /** 지금까지의 부문별 전체 순위(5분 동안 캐시). 집계 중·투표 중 화면이 쓴다. */
  private async liveRanks(now: number): Promise<Record<ScoreCategory, RankedSong[]>> {
    if (this.cache && now - this.cache.at < STANDINGS_CACHE_MS) return this.cache.ranks;
    const s = scheduleOf();
    const through = dayOf(now) < s.toDay ? dayOf(now) : s.toDay;
    const totals = await this.totals(s.fromDay, through);
    const ranks = rankScores(totals, await this.rookieUids(totals, s.rookieFrom));
    this.cache = { at: now, ranks };
    return ranks;
  }

  private async standings(viewerId: string, now: number): Promise<AwardStandingDto[]> {
    const ranks = await this.liveRanks(now);
    const row = (r: RankedSong): AwardRowDto => ({ rank: r.rank, title: r.song.title, artist: r.song.artist, value: r.value, mine: r.song.uid === viewerId, reward: 0 });
    return SCORE_CATEGORIES.map((category) => {
      const list = ranks[category];
      const mine = list.find((r) => r.song.uid === viewerId);
      return { category, top: list.slice(0, STANDINGS_TOP).map(row), mine: mine && mine.rank > STANDINGS_TOP ? row(mine) : null };
    });
  }

  /* ---------- 화면 ---------- */

  async overview(viewer: UserDto, now = Date.now()): Promise<AwardsDto> {
    await this.freeze(now);
    const s = scheduleOf();
    const phase = phaseOf(now);
    const me = new Types.ObjectId(viewer.id);
    const [myVotes, myClaims] = await Promise.all([this.votes.find({ period: this.period, userId: me }).lean().exec(), this.claims.find({ period: this.period, userId: me }).lean().exec()]);
    const edition = phase === 'collecting' ? null : await this.editions.findOne({ period: this.period }).lean().exec();

    let standings: AwardStandingDto[] | null = null;
    let ballot: AwardBallotDto[] | null = null;
    let results: AwardResultDto[] | null = null;
    let items: AwardItemDto[] = [];
    let canVote = false;
    let voteBlocked: string | null = null;

    if (phase === 'collecting' || phase === 'voting') standings = await this.standings(viewer.id, now);
    if (phase === 'voting') {
      const candidates = edition?.candidates ?? [];
      ballot = VOTE_CATEGORIES.map((category) => ({
        category,
        candidates: candidates.filter((c) => c.category === category).map((c) => ({ key: c.key, title: c.title, artist: c.artist, points: c.points, mine: c.uid === viewer.id })),
        votedKey: myVotes.find((v) => v.category === category)?.key ?? null,
      }));
      const gate = await this.gateOf(viewer.id, now);
      canVote = gate === null;
      voteBlocked = gate ? BLOCKED_TEXT[gate] : null;
    }
    if (phase === 'announced' || phase === 'closed') {
      const rows = edition?.results ?? [];
      results = AWARD_CATEGORIES.map((category) => ({
        category,
        rows: rows.filter((r) => r.category === category).map((r) => ({ rank: r.rank, title: r.title, artist: r.artist, value: r.value, mine: r.uid === viewer.id, reward: rewardFor(category, r.rank) })),
      }));
      const claimed = new Set(myClaims.map((c) => c.item));
      items = claimItemsOf(AWARD_YEAR, viewer.id, rows, myVotes.map((v) => v.category)).map((it) => ({ ...it, claimed: claimed.has(it.id) }));
    }
    return {
      period: this.period,
      phase,
      now,
      voteFrom: s.voteFrom,
      announceAt: s.announceAt,
      claimUntil: s.claimUntil,
      rookieFrom: s.rookieFrom,
      standings,
      ballot,
      canVote,
      voteBlocked,
      results,
      items,
      canClaim: phase === 'announced' && items.some((i) => !i.claimed),
      trophies: myClaims.map((c) => c.trophy).filter((t): t is string => !!t),
    };
  }

  /* ---------- 투표 ---------- */

  async vote(viewer: UserDto, body: { category?: unknown; key?: unknown } | undefined, now = Date.now()): Promise<{ category: string; key: string }> {
    if (phaseOf(now) !== 'voting') throw new ConflictException('지금은 투표 기간이 아니에요.');
    const category = body?.category;
    const key = body?.key;
    if (!isVoteCategory(category) || typeof key !== 'string' || key.length === 0 || key.length > 200) throw new BadRequestException('투표할 곡을 골라 주세요.');
    const candidates = await this.ensureCandidates();
    const pick = candidates.find((c) => c.category === category && c.key === key);
    if (!pick) throw new NotFoundException('후보에 없는 곡이에요.');
    if (pick.uid === viewer.id) throw new BadRequestException('내 곡에는 투표할 수 없어요.');
    const gate = await this.gateOf(viewer.id, now);
    if (gate) throw new ForbiddenException(BLOCKED_TEXT[gate]);
    try {
      await this.votes.create({ period: this.period, category, userId: new Types.ObjectId(viewer.id), key, createdAt: new Date(now) });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('이 부문에는 이미 투표했어요.');
      throw e;
    }
    return { category, key };
  }

  private async gateOf(userId: string, now: number): Promise<VoteGate> {
    const id = new Types.ObjectId(userId);
    const [user, save] = await Promise.all([this.users.findById(id, { createdAt: 1 }).lean().exec(), this.saves.findOne({ userId: id }, { fans: 1 }).lean().exec()]);
    return voteGate(user?.createdAt ? new Date(user.createdAt).getTime() : null, save?.fans ?? 0, now);
  }

  /* ---------- 보상 ---------- */

  /**
   * 받을 수 있는 보상을 전부 한 번씩 내준다. 보상 줄마다 `award_claims`의 유일 키로 한 번만 만들어지고, 이미 있으면 건너뛴다.
   * 받은 것으로 표시할 뿐이고 다이아·트로피 반영은 클라이언트가 한다(챌린지·차트 보상과 같은 방식).
   */
  async claim(viewer: UserDto, now = Date.now()): Promise<AwardClaimDto> {
    if (phaseOf(now) !== 'announced') throw new ConflictException('지금은 보상을 받을 수 있는 기간이 아니에요.');
    const candidates = await this.ensureCandidates();
    const results = await this.ensureResults(candidates);
    const me = new Types.ObjectId(viewer.id);
    const myVotes = await this.votes.find({ period: this.period, userId: me }).lean().exec();
    const got: AwardClaimDto = { diamonds: 0, trophies: [], items: [] };
    for (const it of claimItemsOf(AWARD_YEAR, viewer.id, results, myVotes.map((v) => v.category))) {
      try {
        await this.claims.create({ period: this.period, item: it.id, userId: me, diamonds: it.diamonds, trophy: it.trophy, createdAt: new Date(now) });
      } catch (e) {
        if ((e as { code?: number }).code === 11000) continue; // 이미 받은 보상
        throw e;
      }
      got.diamonds += it.diamonds;
      if (it.trophy) got.trophies.push(it.trophy);
      got.items.push({ id: it.id, kind: it.kind, category: it.category, rank: it.rank, diamonds: it.diamonds });
    }
    if (got.items.length === 0) throw new ConflictException('받을 보상이 없어요.');
    return got;
  }

  /**
   * 더보기 알림 점용 개수(0 또는 1): 투표 단계에서 아직 투표하지 않은 부문이 있고 투표할 수 있거나, 발표 단계에서 받지 않은 보상이 있으면 1.
   * 값싼 읽기만 하고 확정 자료를 새로 계산하지는 않는다(계산은 집계 타이머와 화면이 한다).
   */
  async pendingCount(userId: string, now = Date.now()): Promise<number> {
    const phase = phaseOf(now);
    if (phase !== 'voting' && phase !== 'announced') return 0;
    const me = new Types.ObjectId(userId);
    const myVotes = await this.votes.find({ period: this.period, userId: me }, { category: 1 }).lean().exec();
    if (phase === 'voting') {
      if (myVotes.length >= VOTE_CATEGORIES.length) return 0;
      return (await this.gateOf(userId, now)) === null ? 1 : 0;
    }
    const edition = await this.editions.findOne({ period: this.period }, { results: 1 }).lean().exec();
    const items = claimItemsOf(AWARD_YEAR, userId, edition?.results ?? [], myVotes.map((v) => v.category));
    if (items.length === 0) return 0;
    const claimed = await this.claims.countDocuments({ period: this.period, userId: me, item: { $in: items.map((i) => i.id) } }).exec();
    return claimed < items.length ? 1 : 0;
  }
}

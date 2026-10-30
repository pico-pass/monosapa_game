import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { cleanLine, textLength } from '../common/text.js';
import { weekOf, weekStart } from '../common/week.js';
import { User } from '../users/user.schema.js';
import { ChallengeEntry, type ChallengeEntryDocument } from './challenge.schema.js';
import type { ChallengeClaimDto, ChallengeDto, ChallengeEntryDto, ChallengeHallDto, ChallengeLastDto, ChallengeLikeDto } from './dto/challenge.dto.js';

export const CHALLENGE_MAX_LENGTH = 60;
/** 순위 목록에 내려주는 글 수 */
export const CHALLENGE_LIST_SIZE = 30;
/** 이 수 이상 신고되면 숨긴다 */
export const CHALLENGE_HIDE_REPORTS = 3;
const HALL_WEEKS = 8;
const WEEK_MS = 7 * 24 * 3600_000;

/** 매주 돌아가며 나오는 주제. 주 번호로 정해진다. */
export const CHALLENGE_THEMES: readonly string[] = [
  '#새벽감성',
  '#막차',
  '#읽씹',
  '#편의점',
  '#비오는날',
  '#옥상',
  '#지각',
  '#일기장',
  '#보름달',
  '#야자',
  '#이불속',
  '#첫눈',
];
export const themeOf = (week: number): string => CHALLENGE_THEMES[((week % CHALLENGE_THEMES.length) + CHALLENGE_THEMES.length) % CHALLENGE_THEMES.length];

/** 지난주 결과 보상(다이아): 1위 10, 2위 6, 3위 4, 참가 1 + 좋아요 5개마다 1(최대 +5) */
export function rewardOf(rank: number, likes: number): number {
  const base = rank === 1 ? 10 : rank === 2 ? 6 : rank === 3 ? 4 : 1;
  return base + Math.min(5, Math.floor(likes / 5));
}

@Injectable()
export class ChallengeService {
  constructor(
    @InjectModel(ChallengeEntry.name) private readonly entries: Model<ChallengeEntry>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async overview(viewer: UserDto, now = Date.now()): Promise<ChallengeDto> {
    const week = weekOf(now);
    const docs = await this.entries.find({ week, hidden: false }).sort({ likes: -1, createdAt: 1 }).limit(CHALLENGE_LIST_SIZE).exec();
    const mineDoc = await this.entries.findOne({ week, userId: new Types.ObjectId(viewer.id), hidden: false }).exec();
    const lastWeek = week - 1;
    const lastTop = await this.entries.find({ week: lastWeek, hidden: false }).sort({ likes: -1, createdAt: 1 }).limit(3).exec();
    const lastMine = await this.entries.findOne({ week: lastWeek, userId: new Types.ObjectId(viewer.id), hidden: false }).exec();
    const hallDocs = await this.hallDocs(week);

    const need = [...docs, ...lastTop, ...hallDocs, ...(mineDoc ? [mineDoc] : [])];
    const names = await this.namesOf(need.map((d) => d.userId));
    const dto = (d: ChallengeEntryDocument, rank: number): ChallengeEntryDto => this.toDto(d, rank, viewer, names);

    const entries = docs.map((d, i) => dto(d, i + 1));
    let mine: ChallengeEntryDto | null = null;
    if (mineDoc && !entries.some((e) => e.mine)) {
      const ahead = await this.rankOf(mineDoc);
      mine = dto(mineDoc, ahead);
    }

    let last: ChallengeLastDto | null = null;
    if (lastTop.length > 0 || lastMine) {
      const myRank = lastMine ? await this.rankOf(lastMine) : null;
      last = {
        week: lastWeek,
        theme: themeOf(lastWeek),
        myRank,
        myLikes: lastMine?.likes ?? 0,
        reward: lastMine && !lastMine.claimed && myRank ? rewardOf(myRank, lastMine.likes) : null,
        claimed: !!lastMine?.claimed,
        top: lastTop.map((d, i) => dto(d, i + 1)),
      };
    }
    const hall: ChallengeHallDto[] = hallDocs.map((d) => ({ week: d.week, theme: themeOf(d.week), name: names.get(String(d.userId)) ?? '익명', text: d.text, likes: d.likes }));
    return { week, theme: themeOf(week), endsAt: weekStart(week) + WEEK_MS, entries, mine, last, hall };
  }

  async post(user: UserDto, body: { text?: unknown } | undefined, now = Date.now()): Promise<ChallengeEntryDto> {
    const text = cleanLine(body?.text);
    if (textLength(text) === 0) throw new BadRequestException('한 줄을 입력해 주세요.');
    if (textLength(text) > CHALLENGE_MAX_LENGTH) throw new BadRequestException(`${CHALLENGE_MAX_LENGTH}자까지 쓸 수 있어요.`);
    try {
      const doc = await this.entries.create({ userId: new Types.ObjectId(user.id), week: weekOf(now), text });
      return this.toDto(doc, 0, user, new Map([[user.id, user.name?.trim() || '익명']]));
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('이번 주에는 이미 한 줄을 올렸어요.');
      throw e;
    }
  }

  /** 좋아요를 누르거나 취소한다(토글). 내 글에는 누를 수 없다. */
  async like(user: UserDto, id: string, now = Date.now()): Promise<ChallengeLikeDto> {
    const uid = new Types.ObjectId(user.id);
    const doc = await this.current(id, now);
    if (String(doc.userId) === user.id) throw new BadRequestException('내 글에는 좋아요를 누를 수 없어요.');
    const added = await this.entries.findOneAndUpdate({ _id: doc._id, likedBy: { $ne: uid } }, { $addToSet: { likedBy: uid }, $inc: { likes: 1 } }, { returnDocument: 'after' }).exec();
    if (added) return { likes: added.likes, liked: true };
    const removed = await this.entries.findOneAndUpdate({ _id: doc._id, likedBy: uid }, { $pull: { likedBy: uid }, $inc: { likes: -1 } }, { returnDocument: 'after' }).exec();
    return { likes: removed?.likes ?? doc.likes, liked: false };
  }

  async report(user: UserDto, id: string, now = Date.now()): Promise<void> {
    const uid = new Types.ObjectId(user.id);
    const doc = await this.current(id, now);
    if (String(doc.userId) === user.id) throw new BadRequestException('내 글은 신고할 수 없어요.');
    const updated = await this.entries.findOneAndUpdate({ _id: doc._id }, { $addToSet: { reportedBy: uid } }, { returnDocument: 'after' }).exec();
    if (updated && updated.reportedBy.length >= CHALLENGE_HIDE_REPORTS && !updated.hidden) {
      await this.entries.updateOne({ _id: doc._id }, { $set: { hidden: true } }).exec();
    }
  }

  async remove(user: UserDto, id: string): Promise<void> {
    if (!isValidObjectId(id)) throw new NotFoundException('글을 찾을 수 없어요.');
    const doc = await this.entries.findById(id).exec();
    if (!doc) throw new NotFoundException('글을 찾을 수 없어요.');
    if (String(doc.userId) !== user.id && !user.isAdmin) throw new ForbiddenException('내 글만 지울 수 있어요.');
    await this.entries.deleteOne({ _id: doc._id }).exec();
  }

  /** 지난주 결과 보상을 한 번만 계산해서 돌려준다. 받은 것으로 표시하고, 반영은 클라이언트가 한다. */
  async claim(user: UserDto, now = Date.now()): Promise<ChallengeClaimDto> {
    const week = weekOf(now) - 1;
    const mine = await this.entries.findOne({ week, userId: new Types.ObjectId(user.id), hidden: false }).exec();
    if (!mine) throw new NotFoundException('받을 보상이 없어요.');
    if (mine.claimed) throw new ConflictException('이미 받았어요.');
    const rank = await this.rankOf(mine);
    const taken = await this.entries.findOneAndUpdate({ _id: mine._id, claimed: false }, { $set: { claimed: true } }, { returnDocument: 'after' }).exec();
    if (!taken) throw new ConflictException('이미 받았어요.');
    return { week, rank, diamonds: rewardOf(rank, mine.likes), text: mine.text };
  }

  /* ---------- 내부 ---------- */

  /** 이번 주의 보이는 글 하나 */
  private async current(id: string, now: number): Promise<ChallengeEntryDocument> {
    if (!isValidObjectId(id)) throw new NotFoundException('글을 찾을 수 없어요.');
    const doc = await this.entries.findOne({ _id: id, week: weekOf(now), hidden: false }).exec();
    if (!doc) throw new NotFoundException('글을 찾을 수 없어요.');
    return doc;
  }

  /** 그 주 안에서의 순위(1부터): 좋아요가 많을수록, 같으면 먼저 쓴 글이 앞선다. */
  private async rankOf(d: ChallengeEntryDocument): Promise<number> {
    const ahead = await this.entries
      .countDocuments({ week: d.week, hidden: false, $or: [{ likes: { $gt: d.likes } }, { likes: d.likes, createdAt: { $lt: d.createdAt } }] })
      .exec();
    return ahead + 1;
  }

  /** 지난 HALL_WEEKS주의 1위 글(좋아요가 하나라도 있는 주만) */
  private async hallDocs(week: number): Promise<ChallengeEntryDocument[]> {
    const out: ChallengeEntryDocument[] = [];
    for (let w = week - 1; w >= week - HALL_WEEKS; w--) {
      const top = await this.entries.findOne({ week: w, hidden: false, likes: { $gt: 0 } }).sort({ likes: -1, createdAt: 1 }).exec();
      if (top) out.push(top);
    }
    return out;
  }

  private async namesOf(ids: Types.ObjectId[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.map(String))].map((i) => new Types.ObjectId(i));
    const users = await this.users.find({ _id: { $in: unique } }, { name: 1 }).exec();
    return new Map(users.map((u) => [String(u._id), u.name?.trim() || '익명']));
  }

  private toDto(d: ChallengeEntryDocument, rank: number, viewer: UserDto, names: Map<string, string>): ChallengeEntryDto {
    const mine = String(d.userId) === viewer.id;
    return {
      id: String(d._id),
      rank,
      name: names.get(String(d.userId)) ?? '익명',
      picture: null,
      text: d.text,
      likes: d.likes,
      liked: d.likedBy.some((u) => String(u) === viewer.id),
      mine,
      canDelete: mine || viewer.isAdmin,
    };
  }
}

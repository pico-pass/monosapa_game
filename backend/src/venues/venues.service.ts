import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type QueryFilter, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { RateLimiter } from '../common/rate-limit.js';
import { cleanLine, textLength } from '../common/text.js';
import { dayOf, weekOf } from '../common/week.js';
import { FriendsService } from '../friends/friends.service.js';
import { MailboxService } from '../mailbox/mailbox.service.js';
import { Save } from '../saves/save.schema.js';
import { PERSON_FIELDS, toPerson } from '../users/person.js';
import { assertNotMuted } from '../users/profile.js';
import { User } from '../users/user.schema.js';
import type { MyVenueBodyDto, MyVenueDto, SaveVenueDto, VenueBriefDto, VenueClaimDto, VenueLikeDto, VenueListDto, VenuePlayDto, VenueWeeklyDto } from './dto/venues.dto.js';
import {
  LIST_MAX_PAGE,
  LIST_PAGE_SIZE,
  NAME_MAX,
  NAME_MIN,
  RENT_DAILY_MAX,
  RENT_FEE,
  VENUE_MIN_FANS,
  VISITS_PER_DAY,
  cellsFromStored,
  cellsToStored,
  isTheme,
  parseCells,
  rankWeekly,
  scoreVenue,
  type WeeklyRank,
} from './rules.js';
import { Venue, VenueClaim, VenueLike, VenuePlay, type VenueDocument } from './venue.schema.js';

export type VenueSort = 'popular' | 'new' | 'friends';

const isDuplicate = (e: unknown): boolean => (e as { code?: number }).code === 11000;
/** 지난주 순위는 좋아요 취소 같은 작은 변화만 있어서 잠깐 기억해 두어도 된다(알림 점이 30초마다 부른다). */
const WEEKLY_CACHE_MS = 60_000;
/** 순위권 후보를 넉넉히 읽는다: 숨김 처리된 무대가 섞여도 3곳이 채워지게 */
const WEEKLY_CANDIDATES = 10;

@Injectable()
export class VenuesService {
  /** 올리기 도배 방지: 2초 간격, 1분 10번, 같은 내용은 3초 안에 다시 못 올린다 */
  private readonly limiter = new RateLimiter(2000, 10, 3000);
  private readonly weeklyCache = new Map<number, { at: number; top: WeeklyRank[] }>();

  constructor(
    @InjectModel(Venue.name) private readonly venues: Model<Venue>,
    @InjectModel(VenueLike.name) private readonly likes: Model<VenueLike>,
    @InjectModel(VenuePlay.name) private readonly plays: Model<VenuePlay>,
    @InjectModel(VenueClaim.name) private readonly claims: Model<VenueClaim>,
    @InjectModel(Save.name) private readonly saves: Model<Save>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly friends: FriendsService,
    private readonly mailbox: MailboxService,
  ) {}

  /* ---------- 내 무대 ---------- */

  async mine(user: UserDto, now = Date.now()): Promise<MyVenueDto> {
    const uid = new Types.ObjectId(user.id);
    const [doc, visitsLeft] = await Promise.all([this.venues.findOne({ userId: uid }).exec(), this.visitsLeft(uid, now)]);
    return { venue: doc ? this.toBody(doc) : null, weekly: await this.weeklyOf(user.id, doc, now), visitsLeft };
  }

  /** 내 무대를 올린다(새로 만들거나 덮어쓴다). 점수·등급은 서버가 칸에서 다시 계산한다. */
  async save(user: UserDto, body: SaveVenueDto | undefined, now = Date.now()): Promise<MyVenueDto> {
    assertNotMuted(user, '무대를 올릴');
    await this.assertOpen(user.id, '무대를 올릴');
    const name = cleanLine(body?.name);
    const len = textLength(name);
    if (len < NAME_MIN || len > NAME_MAX) throw new BadRequestException(`무대 이름은 ${NAME_MIN}~${NAME_MAX}자로 지어 주세요.`);
    const theme = body?.theme;
    if (!isTheme(theme)) throw new BadRequestException('무대 분위기(일반·어둠)가 올바르지 않아요.');
    const cells = parseCells(body?.cells);
    if (!cells) throw new BadRequestException('무대 모양이 올바르지 않아요.');
    if (cells.every((c) => c === null)) throw new BadRequestException('장치를 하나 이상 놓아 주세요.');
    this.limiter.check(user.id, `${name}|${theme}|${cells.map((c) => c ?? '').join(',')}`, now);

    const score = scoreVenue(cells, theme);
    const userId = new Types.ObjectId(user.id);
    const update = {
      $set: { name, theme, cells: cellsToStored(cells), score: score.total, grade: score.grade, hidden: false, editedAt: new Date(now) },
      $setOnInsert: { likes: 0, plays: 0, rentDay: '', rentToday: 0 },
    };
    const run = () => this.venues.findOneAndUpdate({ userId }, update, { upsert: true, returnDocument: 'after' }).exec();
    let doc: VenueDocument | null;
    try {
      doc = await run();
    } catch (e) {
      // 같은 계정이 동시에 처음 올리면 한쪽이 유일 인덱스에 걸린다. 한 번 더 하면 이미 있는 문서를 고친다.
      if (!isDuplicate(e)) throw e;
      doc = await run();
    }
    if (!doc) throw new NotFoundException('무대를 저장하지 못했어요.');
    return { venue: this.toBody(doc), weekly: await this.weeklyOf(user.id, doc, now), visitsLeft: await this.visitsLeft(userId, now) };
  }

  /* ---------- 둘러보기 ---------- */

  async list(viewer: UserDto, sortRaw: unknown, pageRaw: unknown, now = Date.now()): Promise<VenueListDto> {
    const sort: VenueSort = sortRaw === 'new' || sortRaw === 'friends' ? sortRaw : 'popular';
    const page = Math.min(LIST_MAX_PAGE, Math.max(0, Number.isInteger(Number(pageRaw)) ? Number(pageRaw) : 0));
    const me = new Types.ObjectId(viewer.id);
    const filter: QueryFilter<Venue> = { hidden: false, name: { $ne: '' } };
    if (sort === 'friends') filter.userId = { $in: await this.friends.friendIdsOf(viewer.id) };
    const order: Record<string, 1 | -1> = sort === 'popular' ? { likes: -1, editedAt: -1, _id: -1 } : { editedAt: -1, _id: -1 };
    const docs = await this.venues
      .find(filter)
      .sort(order)
      .skip(page * LIST_PAGE_SIZE)
      .limit(LIST_PAGE_SIZE + 1)
      .exec();
    const shown = docs.slice(0, LIST_PAGE_SIZE);
    const ids = shown.map((d) => d._id);
    const day = dayOf(now);
    const [owners, liked, visited, visitsLeft] = await Promise.all([
      this.users.find({ _id: { $in: shown.map((d) => d.userId) } }, PERSON_FIELDS).exec(),
      this.likes.find({ userId: me, venue: { $in: ids } }, 'venue').exec(),
      this.plays.find({ userId: me, day, venue: { $in: ids } }, 'venue').exec(),
      this.visitsLeft(me, now),
    ]);
    const person = new Map(owners.map((u) => [String(u._id), toPerson(u, now)]));
    const likedSet = new Set(liked.map((l) => String(l.venue)));
    const visitedSet = new Set(visited.map((p) => String(p.venue)));
    const venues: VenueBriefDto[] = [];
    for (const d of shown) {
      const p = person.get(String(d.userId));
      if (!p) continue; // 계정이 지워진 무대는 보여 주지 않는다
      venues.push({
        id: String(d._id),
        owner: { uid: p.uid, name: p.name, picture: p.picture, avatar: p.avatar },
        name: d.name,
        theme: d.theme,
        cells: cellsFromStored(d.cells),
        score: d.score,
        grade: d.grade,
        likes: d.likes,
        plays: d.plays,
        liked: likedSet.has(String(d._id)),
        mine: String(d.userId) === viewer.id,
        visitedToday: visitedSet.has(String(d._id)),
      });
    }
    return { venues, page, hasMore: docs.length > LIST_PAGE_SIZE, visitsLeft };
  }

  /* ---------- 공연·좋아요 ---------- */

  /**
   * 남의 무대에서 공연한다. 같은 무대는 하루 한 번((무대, 사람, 날짜) 유일), 하루 VISITS_PER_DAY곳까지이고, 주인에게 대관료가 우편으로 간다.
   * 코인은 서버가 주지 않고 응답의 등급으로 클라이언트가 계산해 반영한다(챌린지·차트 보상과 같은 신뢰 모델).
   */
  async play(viewer: UserDto, id: string, now = Date.now()): Promise<VenuePlayDto> {
    const venue = await this.visible(id);
    if (String(venue.userId) === viewer.id) throw new BadRequestException('내 무대는 「내 무대 공연」으로 공연해요.');
    await this.assertOpen(viewer.id, '남의 무대에서 공연할');
    const me = new Types.ObjectId(viewer.id);
    const day = dayOf(now);
    let play: { _id: Types.ObjectId };
    try {
      play = await this.plays.create({ venue: venue._id, userId: me, day });
    } catch (e) {
      if (isDuplicate(e)) throw new ConflictException('오늘은 이 무대에서 이미 공연했어요.');
      throw e;
    }
    // 먼저 기록한 뒤 센다: 동시에 여러 요청이 와도 한도를 넘겨 주는 일은 없고(많아야 서로 거절당한다) 한도를 넘으면 방금 기록을 되돌린다.
    if ((await this.plays.countDocuments({ userId: me, day }).exec()) > VISITS_PER_DAY) {
      await this.plays.deleteOne({ _id: play._id }).exec();
      throw new HttpException(`오늘은 남의 무대 ${VISITS_PER_DAY}곳에서 이미 공연했어요. 내일 다시 와 주세요.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.venues.updateOne({ _id: venue._id }, { $inc: { plays: 1 } }).exec();
    const rentPaid = await this.payRent(venue, viewer.id, day, now);
    return { grade: venue.grade, rentPaid, visitsLeft: await this.visitsLeft(me, now) };
  }

  /** 좋아요를 누르거나 취소한다(토글). 내 무대에는 누를 수 없다. */
  async like(viewer: UserDto, id: string, now = Date.now()): Promise<VenueLikeDto> {
    const venue = await this.visible(id);
    if (String(venue.userId) === viewer.id) throw new BadRequestException('내 무대에는 좋아요를 누를 수 없어요.');
    await this.assertOpen(viewer.id, '좋아요를 누를');
    const me = new Types.ObjectId(viewer.id);
    try {
      await this.likes.create({ venue: venue._id, userId: me, week: weekOf(now) });
    } catch (e) {
      if (!isDuplicate(e)) throw e;
      // 이미 눌렀으면 취소: 문서를 지운 쪽만 숫자를 줄이므로 두 번 줄지 않는다.
      const removed = await this.likes.deleteOne({ venue: venue._id, userId: me }).exec();
      const after =
        removed.deletedCount > 0
          ? await this.venues.findOneAndUpdate({ _id: venue._id, likes: { $gt: 0 } }, { $inc: { likes: -1 } }, { returnDocument: 'after' }).exec()
          : null;
      return { likes: after?.likes ?? Math.max(0, venue.likes - (removed.deletedCount > 0 ? 1 : 0)), liked: false };
    }
    const after = await this.venues.findOneAndUpdate({ _id: venue._id }, { $inc: { likes: 1 } }, { returnDocument: 'after' }).exec();
    return { likes: after?.likes ?? venue.likes + 1, liked: true };
  }

  /* ---------- 지난주 인기 무대 보상 ---------- */

  /** 지난주 인기 무대 3위 안이면 보상을 한 번만 계산해서 돌려준다. 반영은 클라이언트가 한다. */
  async claimWeekly(user: UserDto, now = Date.now()): Promise<VenueClaimDto> {
    const week = weekOf(now) - 1;
    const mine = await this.venues.findOne({ userId: new Types.ObjectId(user.id), hidden: false }, '_id').exec();
    const rank = mine ? (await this.weeklyTop(week, now, true)).find((r) => r.id === String(mine._id)) : undefined;
    if (!rank) throw new NotFoundException('받을 보상이 없어요.');
    try {
      await this.claims.create({ week, userId: new Types.ObjectId(user.id) });
    } catch (e) {
      if (isDuplicate(e)) throw new ConflictException('이미 받았어요.');
      throw e;
    }
    return { week, rank: rank.rank, diamonds: rank.diamonds };
  }

  /** 받을 수 있는 지난주 보상이 있으면 1 (알림 점) */
  async pendingCount(userId: string, now = Date.now()): Promise<number> {
    const uid = new Types.ObjectId(userId);
    const mine = await this.venues.findOne({ userId: uid, hidden: false }, '_id').exec();
    if (!mine) return 0;
    const week = weekOf(now) - 1;
    if (await this.claims.exists({ week, userId: uid }).exec()) return 0;
    return (await this.weeklyTop(week, now)).some((r) => r.id === String(mine._id)) ? 1 : 0;
  }

  /* ---------- 내부 ---------- */

  /** 숨기지 않은 무대 하나 */
  private async visible(id: string): Promise<VenueDocument> {
    if (!isValidObjectId(id)) throw new NotFoundException('무대를 찾을 수 없어요.');
    const doc = await this.venues.findOne({ _id: id, hidden: false, name: { $ne: '' } }).exec();
    if (!doc) throw new NotFoundException('무대를 찾을 수 없어요.');
    return doc;
  }

  /** 팬 수가 모자라면 막는다(서버가 저장에서 계산해 둔 fans). */
  private async assertOpen(userId: string, what: string): Promise<void> {
    const save = (await this.saves.findOne({ userId: new Types.ObjectId(userId) }, { fans: 1 }).lean().exec()) as unknown as { fans?: number } | null;
    if ((save?.fans ?? 0) < VENUE_MIN_FANS) throw new ForbiddenException(`팬 ${VENUE_MIN_FANS.toLocaleString('ko-KR')}명부터 ${what} 수 있어요.`);
  }

  private async visitsLeft(userId: Types.ObjectId, now: number): Promise<number> {
    const used = await this.plays.countDocuments({ userId, day: dayOf(now) }).exec();
    return Math.max(0, VISITS_PER_DAY - used);
  }

  /**
   * 주인에게 대관료 우편을 보낸다. 주인의 하루 상한은 무대 문서의 날짜·횟수를 조건부로 올려서 지키므로(동시에 와도 상한을 넘지 못한다)
   * 우편 `ref`로 같은 방문의 중복 우편도 막는다. 우편을 못 보내도 공연은 이미 끝났으니 오류로 만들지 않는다.
   */
  private async payRent(venue: VenueDocument, visitorId: string, day: string, now: number): Promise<boolean> {
    const sameDay = await this.venues.updateOne({ _id: venue._id, rentDay: day, rentToday: { $lt: RENT_DAILY_MAX } }, { $inc: { rentToday: 1 } }).exec();
    let paid = sameDay.modifiedCount > 0;
    if (!paid) {
      const newDay = await this.venues.updateOne({ _id: venue._id, rentDay: { $ne: day } }, { $set: { rentDay: day, rentToday: 1 } }).exec();
      paid = newDay.modifiedCount > 0;
    }
    if (!paid) return false;
    try {
      await this.mailbox.send(
        String(venue.userId),
        { kind: 'venue', title: '🏗️ 무대 대관료', body: `누군가 「${venue.name}」에서 공연했어요. 대관료 💎${RENT_FEE}이 도착했어요.`, diamonds: RENT_FEE, fromName: '내 무대', ref: `venue-rent:${venue._id}:${visitorId}:${day}` },
        now,
      );
      return true;
    } catch {
      return false;
    }
  }

  /** 그 주(좋아요를 누른 주)에 좋아요를 많이 받은 순으로 숨기지 않은 무대 3곳 */
  private async weeklyTop(week: number, now: number, fresh = false): Promise<WeeklyRank[]> {
    const cached = this.weeklyCache.get(week);
    if (!fresh && cached && now - cached.at < WEEKLY_CACHE_MS) return cached.top;
    const rows = await this.likes
      .aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { week } }, { $group: { _id: '$venue', n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: WEEKLY_CANDIDATES }])
      .exec();
    const alive = await this.venues.find({ _id: { $in: rows.map((r) => r._id) }, hidden: false, name: { $ne: '' } }, '_id').exec();
    const top = rankWeekly(
      rows.map((r) => ({ id: String(r._id), n: r.n })),
      new Set(alive.map((v) => String(v._id))),
    );
    this.weeklyCache.set(week, { at: now, top });
    return top;
  }

  private async weeklyOf(userId: string, doc: VenueDocument | null, now: number): Promise<VenueWeeklyDto> {
    const week = weekOf(now) - 1;
    if (!doc || doc.hidden) return { week, rank: null, diamonds: null, claimed: false };
    const [top, claimed] = await Promise.all([this.weeklyTop(week, now), this.claims.exists({ week, userId: new Types.ObjectId(userId) }).exec()]);
    const rank = top.find((r) => r.id === String(doc._id));
    return { week, rank: rank?.rank ?? null, diamonds: rank && !claimed ? rank.diamonds : null, claimed: !!claimed };
  }

  private toBody(d: VenueDocument): MyVenueBodyDto {
    return {
      id: String(d._id),
      name: d.name,
      theme: d.theme,
      cells: cellsFromStored(d.cells),
      score: d.score,
      grade: d.grade,
      likes: d.likes,
      plays: d.plays,
      hidden: d.hidden,
      editedAt: d.editedAt.getTime(),
    };
  }
}

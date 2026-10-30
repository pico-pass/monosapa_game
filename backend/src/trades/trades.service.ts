import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { User } from '../users/user.schema.js';
import type { PostTradeDto, TradeAcceptDto, TradeCardDto, TradeDto, TradesDto } from './dto/trade.dto.js';
import { Trade, type TradeDocument } from './trade.schema.js';

/** 한 사람이 동시에 열어 둘 수 있는 교환 수 */
export const MAX_OPEN_TRADES = 3;
/** 목록에 내려주는 열린 교환 수 */
const OPEN_PAGE = 40;

/** 포토카드 ID 형태: p{세트 1~6}-{등급 1~6}. frontend의 PHOTO_SETS·PHOTO_GRADES와 맞춘다. */
export const isCardId = (v: unknown): v is string => typeof v === 'string' && /^p[1-6]-[1-6]$/.test(v);

@Injectable()
export class TradesService {
  constructor(
    @InjectModel(Trade.name) private readonly trades: Model<Trade>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async list(viewer: UserDto): Promise<TradesDto> {
    const uid = new Types.ObjectId(viewer.id);
    const [open, mine] = await Promise.all([
      this.trades.find({ status: 'open', userId: { $ne: uid } }).sort({ _id: -1 }).limit(OPEN_PAGE).exec(),
      this.trades.find({ userId: uid, status: { $in: ['open', 'taken'] } }).sort({ _id: -1 }).exec(),
    ]);
    const ids = [...new Set(open.map((t) => String(t.userId)))].map((i) => new Types.ObjectId(i));
    const profiles = await this.users.find({ _id: { $in: ids } }, { name: 1 }).exec();
    const names = new Map(profiles.map((u) => [String(u._id), u.name?.trim() || '익명']));
    const dto = (t: TradeDocument, isMine: boolean): TradeDto => ({
      id: String(t._id),
      give: t.give,
      want: t.want,
      status: t.status === 'taken' ? 'taken' : 'open',
      owner: isMine ? (viewer.name?.trim() || '나') : (names.get(String(t.userId)) ?? '익명'),
      mine: isMine,
    });
    return { open: open.map((t) => dto(t, false)), mine: mine.map((t) => dto(t, true)) };
  }

  async post(viewer: UserDto, body: PostTradeDto | undefined): Promise<TradeDto> {
    if (!isCardId(body?.give) || !isCardId(body?.want)) throw new BadRequestException('카드를 골라 주세요.');
    if (body.give === body.want) throw new BadRequestException('같은 카드끼리는 바꿀 수 없어요.');
    const uid = new Types.ObjectId(viewer.id);
    const openCount = await this.trades.countDocuments({ userId: uid, status: { $in: ['open', 'taken'] } }).exec();
    if (openCount >= MAX_OPEN_TRADES) throw new BadRequestException(`교환은 ${MAX_OPEN_TRADES}건까지 올릴 수 있어요.`);
    const doc = await this.trades.create({ userId: uid, give: body.give, want: body.want });
    return { id: String(doc._id), give: doc.give, want: doc.want, status: 'open', owner: viewer.name?.trim() || '나', mine: true };
  }

  /** 다른 사람의 열린 교환을 가져간다. 먼저 누른 한 명만 성공한다. */
  async accept(viewer: UserDto, id: string): Promise<TradeAcceptDto> {
    if (!isValidObjectId(id)) throw new NotFoundException('교환을 찾을 수 없어요.');
    const taken = await this.trades
      .findOneAndUpdate({ _id: id, status: 'open', userId: { $ne: new Types.ObjectId(viewer.id) } }, { $set: { status: 'taken', takerId: new Types.ObjectId(viewer.id) } }, { returnDocument: 'after' })
      .exec();
    if (!taken) throw new ConflictException('이미 끝났거나 가져갈 수 없는 교환이에요.');
    return { give: taken.give, want: taken.want };
  }

  /** 내 교환이 가져가졌으면 원하던 카드를 받는다. 한 번만 받을 수 있다. */
  async collect(viewer: UserDto, id: string): Promise<TradeCardDto> {
    const doc = await this.own(viewer, id);
    const done = await this.trades.findOneAndUpdate({ _id: doc._id, status: 'taken' }, { $set: { status: 'done', doneAt: new Date() } }, { returnDocument: 'after' }).exec();
    if (!done) throw new ConflictException('아직 가져간 사람이 없어요.');
    return { card: done.want };
  }

  /** 아직 아무도 가져가지 않은 내 교환을 거두고 맡겨 둔 카드를 돌려받는다. */
  async cancel(viewer: UserDto, id: string): Promise<TradeCardDto> {
    const doc = await this.own(viewer, id);
    const done = await this.trades.findOneAndUpdate({ _id: doc._id, status: 'open' }, { $set: { status: 'cancelled', doneAt: new Date() } }, { returnDocument: 'after' }).exec();
    if (!done) throw new ConflictException('이미 누가 가져간 교환이에요.');
    return { card: done.give };
  }

  private async own(viewer: UserDto, id: string): Promise<TradeDocument> {
    if (!isValidObjectId(id)) throw new NotFoundException('교환을 찾을 수 없어요.');
    const doc = await this.trades.findById(id).exec();
    if (!doc) throw new NotFoundException('교환을 찾을 수 없어요.');
    if (String(doc.userId) !== viewer.id) throw new ForbiddenException('내 교환만 처리할 수 있어요.');
    return doc;
  }
}

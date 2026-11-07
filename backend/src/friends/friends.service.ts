import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { pairKey } from '../common/pair.js';
import { dayOf } from '../common/week.js';
import { DirectMessage } from '../dm/direct-message.schema.js';
import { MailboxService } from '../mailbox/mailbox.service.js';
import { Save } from '../saves/save.schema.js';
import { PERSON_FIELDS, toPerson, type PersonDto } from '../users/person.js';
import { User, type UserDocument } from '../users/user.schema.js';
import type { FriendDto, FriendsDto, GiftResultDto, Relation, RequestResultDto } from './dto/friends.dto.js';
import { FriendGift } from './gift.schema.js';
import { Friendship, type FriendshipDocument } from './friendship.schema.js';

/** 친구 수 상한, 내가 보내 둔 요청 수 상한, 선물 한 번에 가는 다이아(서버가 정한다) */
export const FRIEND_LIMIT = 30;
export const REQUEST_LIMIT = 20;
export const GIFT_DIAMONDS = 1;

const isDuplicate = (e: unknown): boolean => (e as { code?: number }).code === 11000;

@Injectable()
export class FriendsService {
  constructor(
    @InjectModel(Friendship.name) private readonly friendships: Model<Friendship>,
    @InjectModel(FriendGift.name) private readonly gifts: Model<FriendGift>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Save.name) private readonly saves: Model<Save>,
    @InjectModel(DirectMessage.name) private readonly dms: Model<DirectMessage>,
    private readonly mailbox: MailboxService,
  ) {}

  async list(viewer: UserDto, now = Date.now()): Promise<FriendsDto> {
    const me = new Types.ObjectId(viewer.id);
    const docs = await this.friendships.find({ $or: [{ requester: me }, { addressee: me }] }).exec();
    const otherOf = (d: FriendshipDocument): Types.ObjectId => (String(d.requester) === viewer.id ? d.addressee : d.requester);

    const accepted = docs.filter((d) => d.status === 'accepted');
    const incomingDocs = docs.filter((d) => d.status === 'pending' && String(d.addressee) === viewer.id);
    const outgoingDocs = docs.filter((d) => d.status === 'pending' && String(d.requester) === viewer.id);
    const friendIds = accepted.map(otherOf);

    const [users, saves, gifts, unread, lasts] = await Promise.all([
      this.users.find({ _id: { $in: docs.map(otherOf) } }, PERSON_FIELDS).exec(),
      this.saves.find({ userId: { $in: friendIds } }, 'userId level').exec(),
      this.gifts.find({ day: dayOf(now), $or: [{ from: me, to: { $in: friendIds } }, { to: me, from: { $in: friendIds } }] }).exec(),
      this.dms.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { to: me, readAt: null, from: { $in: friendIds } } }, { $group: { _id: '$from', n: { $sum: 1 } } }]).exec(),
      this.dms
        .aggregate<{ _id: string; text: string; at: Date; from: Types.ObjectId }>([
          { $match: { pair: { $in: accepted.map((d) => d.pair) } } },
          { $sort: { _id: -1 } },
          { $group: { _id: '$pair', text: { $first: '$text' }, at: { $first: '$createdAt' }, from: { $first: '$from' } } },
        ])
        .exec(),
    ]);

    const person = new Map<string, PersonDto>(users.map((u) => [String(u._id), toPerson(u, now)]));
    const levelOf = new Map(saves.map((s) => [String(s.userId), s.level]));
    const sentTo = new Set(gifts.filter((g) => String(g.from) === viewer.id).map((g) => String(g.to)));
    const sentBy = new Set(gifts.filter((g) => String(g.to) === viewer.id).map((g) => String(g.from)));
    const unreadOf = new Map(unread.map((u) => [String(u._id), u.n]));
    const lastOf = new Map(lasts.map((l) => [l._id, l]));

    const friends: FriendDto[] = [];
    for (const d of accepted) {
      const id = String(otherOf(d));
      const p = person.get(id);
      if (!p) continue;
      const last = lastOf.get(d.pair);
      friends.push({
        ...p,
        level: levelOf.get(id) ?? 1,
        giftedToday: sentTo.has(id),
        giftedMeToday: sentBy.has(id),
        unread: unreadOf.get(id) ?? 0,
        last: last ? { text: last.text, at: last.at.getTime(), mine: String(last.from) === viewer.id } : null,
      });
    }
    // 안 읽은 메시지가 있는 친구 먼저, 그다음 최근에 접속한 친구 순
    friends.sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || (a.seenAgoMs ?? Infinity) - (b.seenAgoMs ?? Infinity));

    const pick = (ds: FriendshipDocument[]): PersonDto[] => ds.map((d) => person.get(String(otherOf(d)))).filter((p): p is PersonDto => !!p);
    return { friends, incoming: pick(incomingDocs), outgoing: pick(outgoingDocs), limit: FRIEND_LIMIT, giftDiamonds: GIFT_DIAMONDS };
  }

  /** 친구 요청을 보낸다. 상대가 먼저 보낸 요청이 있으면 바로 친구가 된다. */
  async request(viewer: UserDto, uid: unknown): Promise<RequestResultDto> {
    const target = await this.requireUser(uid);
    const targetId = String(target._id);
    if (targetId === viewer.id) throw new BadRequestException('나에게는 친구 요청을 보낼 수 없어요.');

    const pair = pairKey(viewer.id, targetId);
    const existing = await this.friendships.findOne({ pair }).exec();
    if (existing) {
      if (existing.status === 'accepted') throw new ConflictException('이미 친구예요.');
      if (String(existing.requester) === viewer.id) throw new ConflictException('이미 친구 요청을 보냈어요.');
      await this.accept(viewer, targetId);
      return { status: 'accepted' };
    }

    await this.assertRoom(viewer.id, '친구는 최대 ' + FRIEND_LIMIT + '명까지예요.');
    await this.assertRoom(targetId, '상대의 친구 목록이 가득 차서 요청을 보낼 수 없어요.');
    const outgoing = await this.friendships.countDocuments({ requester: new Types.ObjectId(viewer.id), status: 'pending' }).exec();
    if (outgoing >= REQUEST_LIMIT) throw new BadRequestException(`보내 둔 친구 요청이 너무 많아요. (최대 ${REQUEST_LIMIT}개)`);
    try {
      await this.friendships.create({ pair, requester: new Types.ObjectId(viewer.id), addressee: target._id, status: 'pending' });
    } catch (e) {
      if (isDuplicate(e)) throw new ConflictException('이미 친구 요청이 있어요.');
      throw e;
    }
    return { status: 'requested' };
  }

  /** 받은 요청을 수락한다. */
  async accept(viewer: UserDto, uid: unknown): Promise<void> {
    if (typeof uid !== 'string' || !isValidObjectId(uid)) throw new NotFoundException('받은 친구 요청이 없어요.');
    const doc = await this.friendships.findOne({ pair: pairKey(viewer.id, uid), status: 'pending', addressee: new Types.ObjectId(viewer.id) }).exec();
    if (!doc) throw new NotFoundException('받은 친구 요청이 없어요.');
    await this.assertRoom(viewer.id, '친구는 최대 ' + FRIEND_LIMIT + '명까지예요.');
    await this.assertRoom(uid, '상대의 친구 목록이 가득 차서 수락할 수 없어요.');
    await this.friendships.updateOne({ _id: doc._id, status: 'pending' }, { $set: { status: 'accepted', acceptedAt: new Date() } }).exec();
  }

  /** 받은 요청을 거절하거나 보낸 요청을 취소한다. */
  async cancel(viewer: UserDto, uid: string): Promise<void> {
    if (!isValidObjectId(uid)) throw new NotFoundException('친구 요청이 없어요.');
    const gone = await this.friendships.deleteOne({ pair: pairKey(viewer.id, uid), status: 'pending' }).exec();
    if (gone.deletedCount !== 1) throw new NotFoundException('친구 요청이 없어요.');
  }

  /** 친구를 끊는다. 둘 사이 개인채팅 기록도 지운다. */
  async remove(viewer: UserDto, uid: string): Promise<void> {
    if (!isValidObjectId(uid)) throw new NotFoundException('친구를 찾을 수 없어요.');
    const pair = pairKey(viewer.id, uid);
    const gone = await this.friendships.deleteOne({ pair, status: 'accepted' }).exec();
    if (gone.deletedCount !== 1) throw new NotFoundException('친구를 찾을 수 없어요.');
    await this.dms.deleteMany({ pair }).exec();
  }

  /** 친구에게 하루 한 번 다이아를 선물한다. 받는 쪽 우편함에 다이아가 붙은 우편이 간다. */
  async gift(viewer: UserDto, uid: string, now = Date.now()): Promise<GiftResultDto> {
    if (!isValidObjectId(uid) || !(await this.areFriends(viewer.id, uid))) throw new ForbiddenException('친구에게만 선물할 수 있어요.');
    const from = new Types.ObjectId(viewer.id);
    const to = new Types.ObjectId(uid);
    try {
      await this.gifts.create({ from, to, day: dayOf(now) });
    } catch (e) {
      if (isDuplicate(e)) throw new ConflictException('오늘은 이미 이 친구에게 선물을 보냈어요.');
      throw e;
    }
    try {
      await this.mailbox.send(uid, { kind: 'gift', title: '💎 친구의 선물', body: `${viewer.displayName}님이 보낸 오늘의 선물이에요.`, diamonds: GIFT_DIAMONDS, fromUid: viewer.id, fromName: viewer.displayName }, now);
    } catch (e) {
      await this.gifts.deleteOne({ from, to, day: dayOf(now) }).exec();
      throw e;
    }
    return { diamonds: GIFT_DIAMONDS };
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    if (!isValidObjectId(a) || !isValidObjectId(b)) return false;
    return !!(await this.friendships.exists({ pair: pairKey(a, b), status: 'accepted' }).exec());
  }

  /** 보는 사람과 그 사람의 관계, 그리고 오늘 선물을 보냈는지 */
  async relation(viewerId: string, targetId: string, now = Date.now()): Promise<{ relation: Relation; giftedToday: boolean }> {
    if (viewerId === targetId) return { relation: 'self', giftedToday: false };
    const doc = await this.friendships.findOne({ pair: pairKey(viewerId, targetId) }).exec();
    if (!doc) return { relation: 'none', giftedToday: false };
    if (doc.status === 'pending') return { relation: String(doc.requester) === viewerId ? 'outgoing' : 'incoming', giftedToday: false };
    const sent = await this.gifts.exists({ from: new Types.ObjectId(viewerId), to: new Types.ObjectId(targetId), day: dayOf(now) }).exec();
    return { relation: 'friend', giftedToday: !!sent };
  }

  /** 나에게 온, 아직 수락하지 않은 요청 수 */
  incomingCount(userId: string): Promise<number> {
    return this.friendships.countDocuments({ addressee: new Types.ObjectId(userId), status: 'pending' }).exec();
  }

  private async requireUser(uid: unknown): Promise<UserDocument> {
    const user = typeof uid === 'string' && isValidObjectId(uid) ? await this.users.findById(uid).exec() : null;
    if (!user) throw new NotFoundException('사용자를 찾을 수 없어요.');
    return user;
  }

  /** 친구가 더 늘어도 되는 계정인지 본다. */
  private async assertRoom(userId: string, message: string): Promise<void> {
    const id = new Types.ObjectId(userId);
    const n = await this.friendships.countDocuments({ status: 'accepted', $or: [{ requester: id }, { addressee: id }] }).exec();
    if (n >= FRIEND_LIMIT) throw new BadRequestException(message);
  }
}

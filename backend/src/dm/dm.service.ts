import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { pairKey } from '../common/pair.js';
import { RateLimiter } from '../common/rate-limit.js';
import { cleanLine, textLength } from '../common/text.js';
import { FriendsService } from '../friends/friends.service.js';
import { PERSON_FIELDS, toPerson } from '../users/person.js';
import { assertNotMuted } from '../users/profile.js';
import { User } from '../users/user.schema.js';
import type { DmMessageDto, DmThreadDto, SendDmDto } from './dto/dm.dto.js';
import { DirectMessage, type DirectMessageDocument } from './direct-message.schema.js';

export const DM_MAX_LENGTH = 300;
/** 한 번에 내려주는 최근 메시지 수 */
export const DM_PAGE_SIZE = 60;

const toDto = (m: DirectMessageDocument, viewerId: string): DmMessageDto => ({
  id: String(m._id),
  mine: String(m.from) === viewerId,
  text: m.text,
  at: m.createdAt.getTime(),
  read: m.readAt !== null,
});

@Injectable()
export class DmService {
  /** 연속 전송 1초 간격, 1분에 30개, 같은 말은 10초 안에 반복 불가 */
  private readonly limiter = new RateLimiter(1000, 30, 10_000);

  constructor(
    @InjectModel(DirectMessage.name) private readonly messages: Model<DirectMessage>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly friends: FriendsService,
  ) {}

  /** 친구와의 대화를 불러오고, 받은 메시지를 읽음으로 표시한다. 친구가 아니면 볼 수 없다. */
  async thread(viewer: UserDto, uid: string): Promise<DmThreadDto> {
    const friend = await this.requireFriend(viewer, uid);
    const pair = pairKey(viewer.id, uid);
    const [docs] = await Promise.all([
      this.messages.find({ pair }).sort({ _id: -1 }).limit(DM_PAGE_SIZE).exec(),
      this.messages.updateMany({ pair, to: new Types.ObjectId(viewer.id), readAt: null }, { $set: { readAt: new Date() } }).exec(),
    ]);
    return { friend: toPerson(friend), messages: docs.reverse().map((d) => toDto(d, viewer.id)) };
  }

  async send(viewer: UserDto, uid: string, body: SendDmDto | undefined): Promise<DmMessageDto> {
    assertNotMuted(viewer, '메시지를 보낼');
    await this.requireFriend(viewer, uid);
    const text = cleanLine(body?.text);
    if (textLength(text) === 0) throw new BadRequestException('내용을 입력해 주세요.');
    if (textLength(text) > DM_MAX_LENGTH) throw new BadRequestException(`${DM_MAX_LENGTH}자까지 보낼 수 있어요.`);
    this.limiter.check(viewer.id, text);
    const doc = await this.messages.create({ pair: pairKey(viewer.id, uid), from: new Types.ObjectId(viewer.id), to: new Types.ObjectId(uid), text });
    return toDto(doc, viewer.id);
  }

  private async requireFriend(viewer: UserDto, uid: string) {
    if (!isValidObjectId(uid)) throw new NotFoundException('친구를 찾을 수 없어요.');
    if (!(await this.friends.areFriends(viewer.id, uid))) throw new ForbiddenException('친구와만 대화할 수 있어요.');
    const friend = await this.users.findById(uid, PERSON_FIELDS).exec();
    if (!friend) throw new NotFoundException('친구를 찾을 수 없어요.');
    return friend;
  }
}

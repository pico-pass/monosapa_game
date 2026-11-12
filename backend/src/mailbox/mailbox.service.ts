import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { cleanLine, cleanMultiline, textLength } from '../common/text.js';
import { User } from '../users/user.schema.js';
import type { AdminMailDto, AdminMailResultDto, MailClaimDto, MailDto, MailboxDto } from './dto/mailbox.dto.js';
import { MAIL_RETENTION_DAYS, Mail, type MailDocument, type MailKind } from './mail.schema.js';

export const MAIL_TITLE_MAX = 30;
export const MAIL_BODY_MAX = 500;
/** 운영자가 한 번에 붙일 수 있는 다이아의 상한 */
export const ADMIN_MAIL_MAX_DIAMONDS = 500;
/** 우편 하나에 붙일 수 있는 코인의 상한(이상한 값 방지) */
export const MAX_MAIL_COINS = 10_000_000_000;
const LIST_LIMIT = 100;
const DAY_MS = 86_400_000;

/** 받을 보상(다이아 또는 코인)이 붙은 우편. 예전 우편은 coins 필드가 없어서 $gt 로만 본다. */
const HAS_REWARD = { $or: [{ diamonds: { $gt: 0 } }, { coins: { $gt: 0 } }] };
/** 받을 것이 없거나 이미 받아서 지워도 되는 우편 */
const DISPOSABLE = { $or: [{ claimed: true }, { diamonds: { $not: { $gt: 0 } }, coins: { $not: { $gt: 0 } } }] };

const toDto = (m: MailDocument): MailDto => ({
  id: String(m._id),
  kind: m.kind,
  title: m.title,
  body: m.body,
  diamonds: m.diamonds,
  coins: m.coins ?? 0,
  claimed: m.claimed,
  read: m.read,
  fromName: m.fromName,
  at: m.createdAt.getTime(),
  expiresAt: m.expiresAt.getTime(),
});

export interface NewMail {
  kind: MailKind;
  title: string;
  body?: string;
  diamonds?: number;
  coins?: number;
  fromUid?: string | null;
  fromName?: string | null;
  /** 같은 우편을 두 번 만들지 않게 하는 키(출시 보상 등) */
  ref?: string;
  /** 우편이 남아 있는 기간(기본 MAIL_RETENTION_DAYS) */
  retentionDays?: number;
}

@Injectable()
export class MailboxService {
  constructor(
    @InjectModel(Mail.name) private readonly mails: Model<Mail>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** 다른 기능(친구 선물·신고 처리)이 우편을 보낼 때 쓴다. */
  async send(to: string, mail: NewMail, now = Date.now()): Promise<MailDocument> {
    return this.mails.create(this.build(to, mail, now));
  }

  private build(to: string, mail: NewMail, now: number) {
    return {
      userId: new Types.ObjectId(to),
      kind: mail.kind,
      title: mail.title,
      body: mail.body ?? '',
      diamonds: Math.max(0, Math.floor(mail.diamonds ?? 0)),
      coins: Math.min(MAX_MAIL_COINS, Math.max(0, Math.floor(mail.coins ?? 0))),
      fromUid: mail.fromUid ? new Types.ObjectId(mail.fromUid) : null,
      fromName: mail.fromName ?? null,
      ...(mail.ref ? { ref: mail.ref } : {}),
      expiresAt: new Date(now + (mail.retentionDays ?? MAIL_RETENTION_DAYS) * DAY_MS),
    };
  }

  async list(user: UserDto): Promise<MailboxDto> {
    const uid = new Types.ObjectId(user.id);
    const [docs, counts] = await Promise.all([this.mails.find({ userId: uid }).sort({ _id: -1 }).limit(LIST_LIMIT).exec(), this.counts(uid)]);
    return { mails: docs.map(toDto), ...counts };
  }

  /** 안 읽은 우편 수와 받지 않은 보상(다이아·코인)이 붙은 우편 수 */
  async counts(uid: Types.ObjectId): Promise<{ unread: number; claimable: number }> {
    const [unread, claimable] = await Promise.all([
      this.mails.countDocuments({ userId: uid, read: false }).exec(),
      this.mails.countDocuments({ userId: uid, claimed: false, ...HAS_REWARD }).exec(),
    ]);
    return { unread, claimable };
  }

  async readAll(user: UserDto): Promise<void> {
    await this.mails.updateMany({ userId: new Types.ObjectId(user.id), read: false }, { $set: { read: true } }).exec();
  }

  /** 보상(다이아·코인)을 받은 것으로 표시하고 양을 돌려준다. 반영은 클라이언트가 한다. 한 우편은 한 번만 받는다. */
  async claim(user: UserDto, id: string): Promise<MailClaimDto> {
    if (!isValidObjectId(id)) throw new NotFoundException('우편을 찾을 수 없어요.');
    const uid = new Types.ObjectId(user.id);
    const taken = await this.mails.findOneAndUpdate({ _id: id, userId: uid, claimed: false, ...HAS_REWARD }, { $set: { claimed: true, read: true } }, { returnDocument: 'after' }).exec();
    if (taken) return { diamonds: taken.diamonds, coins: taken.coins ?? 0, count: 1 };
    const doc = await this.mails.findOne({ _id: id, userId: uid }).exec();
    if (!doc) throw new NotFoundException('우편을 찾을 수 없어요.');
    throw new ConflictException(doc.diamonds > 0 || (doc.coins ?? 0) > 0 ? '이미 받았어요.' : '받을 보상이 없는 우편이에요.');
  }

  /** 받지 않은 보상(다이아·코인)을 한꺼번에 받는다. */
  async claimAll(user: UserDto): Promise<MailClaimDto> {
    const uid = new Types.ObjectId(user.id);
    const open = await this.mails.find({ userId: uid, claimed: false, ...HAS_REWARD }, '_id').limit(LIST_LIMIT).exec();
    let diamonds = 0;
    let coins = 0;
    let count = 0;
    for (const m of open) {
      const taken = await this.mails.findOneAndUpdate({ _id: m._id, userId: uid, claimed: false }, { $set: { claimed: true, read: true } }, { returnDocument: 'after' }).exec();
      if (taken) {
        diamonds += taken.diamonds;
        coins += taken.coins ?? 0;
        count++;
      }
    }
    if (count === 0) throw new NotFoundException('받을 보상이 없어요.');
    return { diamonds, coins, count };
  }

  /** 우편 하나를 지운다. 받지 않은 보상이 붙은 우편은 지울 수 없다. */
  async remove(user: UserDto, id: string): Promise<void> {
    if (!isValidObjectId(id)) throw new NotFoundException('우편을 찾을 수 없어요.');
    const uid = new Types.ObjectId(user.id);
    const gone = await this.mails.deleteOne({ _id: id, userId: uid, ...DISPOSABLE }).exec();
    if (gone.deletedCount === 1) return;
    const doc = await this.mails.findOne({ _id: id, userId: uid }).exec();
    if (!doc) throw new NotFoundException('우편을 찾을 수 없어요.');
    throw new ConflictException('받지 않은 보상이 있어서 지울 수 없어요. 먼저 받아 주세요.');
  }

  /** 읽었고 받을 것도 없는 우편을 모두 지운다. */
  async removeDone(user: UserDto): Promise<void> {
    await this.mails.deleteMany({ userId: new Types.ObjectId(user.id), read: true, ...DISPOSABLE }).exec();
  }

  /** 관리자: 한 사람 또는 모든 계정에 우편(다이아 포함 가능)을 보낸다. */
  async adminSend(body: AdminMailDto | undefined, now = Date.now()): Promise<AdminMailResultDto> {
    const title = cleanLine(body?.title);
    const text = cleanMultiline(body?.body);
    if (textLength(title) === 0 || textLength(title) > MAIL_TITLE_MAX) throw new BadRequestException(`제목은 1~${MAIL_TITLE_MAX}자로 적어 주세요.`);
    if (textLength(text) > MAIL_BODY_MAX) throw new BadRequestException(`내용은 ${MAIL_BODY_MAX}자까지 적을 수 있어요.`);
    const diamonds = body?.diamonds ?? 0;
    if (!Number.isInteger(diamonds) || diamonds < 0 || diamonds > ADMIN_MAIL_MAX_DIAMONDS) {
      throw new BadRequestException(`다이아는 0~${ADMIN_MAIL_MAX_DIAMONDS}개의 정수로 적어 주세요.`);
    }
    const mail: NewMail = { kind: 'admin', title, body: text, diamonds, fromName: '운영팀' };

    if (body?.to === 'all') {
      const ids = await this.users.find({}, '_id').exec();
      if (ids.length === 0) return { sent: 0 };
      await this.mails.insertMany(ids.map((u) => this.build(String(u._id), mail, now)));
      return { sent: ids.length };
    }
    if (typeof body?.to !== 'string' || !isValidObjectId(body.to) || !(await this.users.exists({ _id: body.to }).exec())) {
      throw new NotFoundException('받는 사람을 찾을 수 없어요.');
    }
    await this.send(body.to, mail, now);
    return { sent: 1 };
  }
}

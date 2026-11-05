import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import { newFriendCode } from './profile.js';
import { seenAgoMs } from './presence.js';
import { User, type UserDocument } from './user.schema.js';

export interface GoogleProfile {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

const isDuplicate = (e: unknown): boolean => (e as { code?: number }).code === 11000;

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly log = new Logger(UsersService.name);

  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** 친구 코드가 생기기 전에 만들어진 계정에 코드를 붙인다. */
  async onModuleInit(): Promise<void> {
    const old = await this.users.find({ friendCode: { $exists: false } }, '_id').exec();
    for (const u of old) await this.ensureFriendCode(String(u._id));
    if (old.length > 0) this.log.log(`친구 코드 채움: ${old.length}개`);
  }

  /** 처음 로그인하면 만들고, 이미 있으면 프로필과 마지막 로그인 시각을 갱신한다. */
  async upsertFromGoogle(profile: GoogleProfile): Promise<UserDocument> {
    const set = { email: profile.email, name: profile.name, picture: profile.picture, lastLoginAt: new Date(), lastSeenAt: new Date() };
    // 친구 코드가 다른 계정과 겹치면(아주 드물다) 다시 뽑는다.
    for (let attempt = 0; ; attempt++) {
      try {
        const user = await this.users
          .findOneAndUpdate({ googleSub: profile.sub }, { $set: set, $setOnInsert: { friendCode: newFriendCode() } }, { upsert: true, returnDocument: 'after' })
          .orFail()
          .exec();
        return user.friendCode ? user : ((await this.ensureFriendCode(String(user._id))) ?? user);
      } catch (e) {
        if (!isDuplicate(e) || attempt >= 4) throw e;
      }
    }
  }

  /** 친구 코드가 없는 계정에 코드를 붙이고 계정을 돌려준다. */
  async ensureFriendCode(id: string): Promise<UserDocument | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const user = await this.users
          .findOneAndUpdate({ _id: id, friendCode: { $exists: false } }, { $set: { friendCode: newFriendCode() } }, { returnDocument: 'after' })
          .exec();
        return user ?? (await this.users.findById(id).exec());
      } catch (e) {
        if (!isDuplicate(e)) throw e;
      }
    }
    return null;
  }

  findById(id: string): Promise<UserDocument | null> {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return this.users.findById(id).exec();
  }

  /** 접속 신호를 기록한다(프로필의 접속 상태). */
  async touch(id: string): Promise<void> {
    if (!isValidObjectId(id)) return;
    await this.users.updateOne({ _id: id }, { $set: { lastSeenAt: new Date() } }).exec();
  }

  /** 계정 ID별 마지막 접속이 몇 ms 전인지 (모르면 null) */
  async seenAgo(ids: Iterable<string>): Promise<Map<string, number | null>> {
    const unique = [...new Set(ids)].filter((i) => isValidObjectId(i)).map((i) => new Types.ObjectId(i));
    const now = Date.now();
    const docs = await this.users.find({ _id: { $in: unique } }, 'lastSeenAt lastLoginAt').exec();
    return new Map(docs.map((u) => [String(u._id), seenAgoMs(u, now)]));
  }
}

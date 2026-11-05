import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import { seenAgoMs } from './presence.js';
import { User, type UserDocument } from './user.schema.js';

export interface GoogleProfile {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** 처음 로그인하면 만들고, 이미 있으면 프로필과 마지막 로그인 시각을 갱신한다. */
  upsertFromGoogle(profile: GoogleProfile): Promise<UserDocument> {
    return this.users
      .findOneAndUpdate(
        { googleSub: profile.sub },
        { $set: { email: profile.email, name: profile.name, picture: profile.picture, lastLoginAt: new Date(), lastSeenAt: new Date() } },
        { upsert: true, returnDocument: 'after' },
      )
      .orFail()
      .exec();
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

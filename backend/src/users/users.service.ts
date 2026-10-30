import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
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
        { $set: { email: profile.email, name: profile.name, picture: profile.picture, lastLoginAt: new Date() } },
        { upsert: true, returnDocument: 'after' },
      )
      .orFail()
      .exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return this.users.findById(id).exec();
  }
}

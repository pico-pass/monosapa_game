import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { cleanLine, textLength } from '../common/text.js';
import { FriendsService } from '../friends/friends.service.js';
import { Save } from '../saves/save.schema.js';
import { toPerson } from '../users/person.js';
import { BIO_MAX, NICKNAME_MAX, NICKNAME_MIN, assertNotMuted, displayNameOf, isAvatar, mutedUntilMs, normalizeFriendCode } from '../users/profile.js';
import { User, type UserDocument } from '../users/user.schema.js';
import type { MyProfileDto, ProfileDto, UpdateProfileDto } from './dto/profiles.dto.js';

const toMine = (u: UserDocument): MyProfileDto => ({
  uid: String(u._id),
  googleName: u.name,
  nickname: u.nickname ?? null,
  bio: u.bio ?? null,
  avatar: u.avatar ?? 'google',
  picture: u.picture,
  name: displayNameOf(u),
  friendCode: u.friendCode ?? null,
  mutedUntil: mutedUntilMs(u),
});

@Injectable()
export class ProfilesService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Save.name) private readonly saves: Model<Save>,
    private readonly friends: FriendsService,
  ) {}

  async me(user: UserDto): Promise<MyProfileDto> {
    const doc = await this.users.findById(user.id).exec();
    if (!doc) throw new NotFoundException('계정을 찾을 수 없어요.');
    return toMine(doc);
  }

  /** 닉네임(2~12자)·한 줄 소개(40자)·프로필 사진 종류를 바꾼다. 닉네임을 비우면 구글 이름으로 돌아간다. */
  async update(user: UserDto, body: UpdateProfileDto | undefined): Promise<MyProfileDto> {
    assertNotMuted(user, '프로필을 바꿀');
    const set: Record<string, unknown> = {};

    if (body?.nickname !== undefined) {
      const nickname = cleanLine(body.nickname);
      if (nickname && (textLength(nickname) < NICKNAME_MIN || textLength(nickname) > NICKNAME_MAX)) {
        throw new BadRequestException(`닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 적어 주세요.`);
      }
      set.nickname = nickname || null;
    }
    if (body?.bio !== undefined) {
      const bio = cleanLine(body.bio);
      if (textLength(bio) > BIO_MAX) throw new BadRequestException(`한 줄 소개는 ${BIO_MAX}자까지 적을 수 있어요.`);
      set.bio = bio || null;
    }
    if (body?.avatar !== undefined) {
      if (!isAvatar(body.avatar)) throw new BadRequestException('프로필 사진 종류가 올바르지 않아요.');
      set.avatar = body.avatar;
    }
    if (Object.keys(set).length === 0) throw new BadRequestException('바꿀 내용이 없어요.');

    const doc = await this.users.findByIdAndUpdate(user.id, { $set: set }, { returnDocument: 'after' }).exec();
    if (!doc) throw new NotFoundException('계정을 찾을 수 없어요.');
    return toMine(doc);
  }

  async byUid(viewer: UserDto, uid: string): Promise<ProfileDto> {
    const doc = isValidObjectId(uid) ? await this.users.findById(uid).exec() : null;
    if (!doc) throw new NotFoundException('사용자를 찾을 수 없어요.');
    return this.view(viewer, doc);
  }

  /** 친구 코드로 사람을 찾는다. */
  async byCode(viewer: UserDto, rawCode: string): Promise<ProfileDto> {
    const code = normalizeFriendCode(rawCode);
    const doc = code ? await this.users.findOne({ friendCode: code }).exec() : null;
    if (!doc) throw new NotFoundException('그 친구 코드를 가진 사용자를 찾을 수 없어요.');
    return this.view(viewer, doc);
  }

  private async view(viewer: UserDto, doc: UserDocument): Promise<ProfileDto> {
    const id = String(doc._id);
    const [save, rel] = await Promise.all([this.saves.findOne({ userId: doc._id }, 'level fans towerBest nurtureNormal nurtureDark').exec(), this.friends.relation(viewer.id, id)]);
    const person = toPerson(doc);
    return {
      ...person,
      level: save?.level ?? 1,
      fans: save?.fans ?? 0,
      towerBest: save?.towerBest ?? 0,
      nurtureNormal: save?.nurtureNormal ?? 1,
      nurtureDark: save?.nurtureDark ?? 1,
      joinedAt: doc.createdAt.getTime(),
      relation: rel.relation,
      giftedToday: rel.giftedToday,
      friendCode: id === viewer.id ? (doc.friendCode ?? null) : null,
      // 내 프로필은 방금 접속한 것으로 본다
      seenAgoMs: id === viewer.id ? 0 : person.seenAgoMs,
    };
  }
}

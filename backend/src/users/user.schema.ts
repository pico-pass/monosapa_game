import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { AVATARS, type Avatar } from './profile.js';

/** 계정. 구글 계정의 고유 ID(sub)로 식별한다. 이메일은 바뀔 수 있어 식별에 쓰지 않는다. */
@Schema({ collection: 'users', timestamps: { createdAt: true, updatedAt: false } })
export class User {
  @Prop({ required: true, unique: true })
  googleSub!: string;

  @Prop({ type: String, default: null })
  email!: string | null;

  @Prop({ type: String, default: null })
  name!: string | null;

  @Prop({ type: String, default: null })
  picture!: string | null;

  @Prop({ required: true })
  lastLoginAt!: Date;

  /** 마지막으로 접속 신호(로그인·`POST /api/auth/ping`)를 받은 시각. 프로필의 접속 상태에 쓴다. 예전 계정은 비어 있다. */
  @Prop({ type: Date, default: null })
  lastSeenAt!: Date | null;

  /** 프로필 설정: 닉네임(없으면 구글 이름을 쓴다), 한 줄 소개, 프로필 사진 종류 */
  @Prop({ type: String, default: null })
  nickname!: string | null;

  @Prop({ type: String, default: null })
  bio!: string | null;

  @Prop({ type: String, enum: AVATARS, default: 'google' })
  avatar!: Avatar;

  /** 친구 코드: 친구를 찾을 때 알려 주는 짧은 코드. 처음 로그인할 때(예전 계정은 서버가 켜질 때) 만들어진다. */
  @Prop({ type: String, index: { unique: true, partialFilterExpression: { friendCode: { $type: 'string' } } } })
  friendCode?: string;

  /** 이 시각까지 챗방·개인채팅·프로필 수정이 막힌다(관리자 제재). 비었거나 지났으면 제한 없음. */
  @Prop({ type: Date, default: null })
  mutedUntil!: Date | null;

  createdAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

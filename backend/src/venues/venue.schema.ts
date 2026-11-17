import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';
import type { VenueTheme } from './rules.js';

/** 하루 방문 기록 보관 기간(지나면 TTL 인덱스가 지운다. 하루 한도는 한국 시간 날짜로 세므로 이틀이면 충분하다). */
export const VENUE_PLAY_RETENTION_SECONDS = 3 * 24 * 3600;
/** 주간 보상 장부 보관 기간 */
export const VENUE_CLAIM_RETENTION_SECONDS = 90 * 24 * 3600;

/** 계정당 하나인 「내 무대」. 칸은 장치 ID 48개이고 빈 칸은 빈 문자열이다. 점수·등급은 올릴 때 서버가 다시 계산한 값이다. */
@Schema({ collection: 'venues', timestamps: { createdAt: true, updatedAt: false } })
export class Venue {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, default: '' })
  name!: string;

  @Prop({ type: String, enum: ['normal', 'dark'], default: 'normal' })
  theme!: VenueTheme;

  @Prop({ type: [String], default: [] })
  cells!: string[];

  @Prop({ type: Number, default: 0 })
  score!: number;

  /** 0(E) ~ 5(S) */
  @Prop({ type: Number, default: 0 })
  grade!: number;

  /** 좋아요 총수(주간 순위는 `venue_likes`를 주 단위로 센다) */
  @Prop({ type: Number, default: 0 })
  likes!: number;

  /** 남이 공연한 횟수 */
  @Prop({ type: Number, default: 0 })
  plays!: number;

  /** 신고 처리로 숨겨졌다. 주인이 다시 올리면 풀린다. */
  @Prop({ type: Boolean, default: false })
  hidden!: boolean;

  /** 대관료를 센 한국 시간 날짜와 그 날 이미 준 횟수(주인 하루 상한) */
  @Prop({ type: String, default: '' })
  rentDay!: string;

  @Prop({ type: Number, default: 0 })
  rentToday!: number;

  /** 마지막으로 올린 시각 */
  @Prop({ type: Date, default: () => new Date() })
  editedAt!: Date;

  createdAt!: Date;
}

export type VenueDocument = HydratedDocument<Venue>;
export const VenueSchema = SchemaFactory.createForClass(Venue);
VenueSchema.index({ userId: 1 }, { unique: true });
VenueSchema.index({ hidden: 1, likes: -1, editedAt: -1 });
VenueSchema.index({ hidden: 1, editedAt: -1 });

/** 좋아요. (무대, 사람)이 유일하고, 만든 주를 적어 두어 지난주 인기 순위를 센다. 취소하면 문서를 지운다. */
@Schema({ collection: 'venue_likes', timestamps: { createdAt: true, updatedAt: false } })
export class VenueLike {
  @Prop({ type: Types.ObjectId, required: true })
  venue!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 좋아요를 누른 한국 시간 월요일 기준 주 번호 */
  @Prop({ required: true })
  week!: number;

  createdAt!: Date;
}

export type VenueLikeDocument = HydratedDocument<VenueLike>;
export const VenueLikeSchema = SchemaFactory.createForClass(VenueLike);
VenueLikeSchema.index({ venue: 1, userId: 1 }, { unique: true });
VenueLikeSchema.index({ week: 1, venue: 1 });

/** 남의 무대에서 공연한 기록. (무대, 사람, 한국 시간 날짜)가 유일해서 같은 무대는 하루에 한 번만 공연한다. */
@Schema({ collection: 'venue_plays', timestamps: { createdAt: true, updatedAt: false } })
export class VenuePlay {
  @Prop({ type: Types.ObjectId, required: true })
  venue!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 한국 시간 날짜 YYYY-MM-DD */
  @Prop({ required: true })
  day!: string;

  createdAt!: Date;
}

export type VenuePlayDocument = HydratedDocument<VenuePlay>;
export const VenuePlaySchema = SchemaFactory.createForClass(VenuePlay);
VenuePlaySchema.index({ venue: 1, userId: 1, day: 1 }, { unique: true });
VenuePlaySchema.index({ userId: 1, day: 1 });
VenuePlaySchema.index({ createdAt: 1 }, { expireAfterSeconds: VENUE_PLAY_RETENTION_SECONDS });

/** 지난주 인기 무대 보상을 받았다는 장부. (주, 사람)이 유일해서 한 번만 받는다. */
@Schema({ collection: 'venue_claims', timestamps: { createdAt: true, updatedAt: false } })
export class VenueClaim {
  @Prop({ required: true })
  week!: number;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  createdAt!: Date;
}

export type VenueClaimDocument = HydratedDocument<VenueClaim>;
export const VenueClaimSchema = SchemaFactory.createForClass(VenueClaim);
VenueClaimSchema.index({ week: 1, userId: 1 }, { unique: true });
VenueClaimSchema.index({ createdAt: 1 }, { expireAfterSeconds: VENUE_CLAIM_RETENTION_SECONDS });

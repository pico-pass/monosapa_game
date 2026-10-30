import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 보관 기간. 지나면 MongoDB TTL 인덱스가 지운다. */
export const CHALLENGE_RETENTION_SECONDS = 90 * 24 * 3600;

/** 해시태그 챌린지의 한 줄. 사람마다 한 주(week)에 하나만 올릴 수 있다. */
@Schema({ collection: 'challenge_entries', timestamps: { createdAt: true, updatedAt: false } })
export class ChallengeEntry {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 한국 시간 월요일 기준 주 번호 */
  @Prop({ required: true })
  week!: number;

  @Prop({ required: true })
  text!: string;

  @Prop({ required: true, default: 0 })
  likes!: number;

  @Prop({ type: [Types.ObjectId], default: [] })
  likedBy!: Types.ObjectId[];

  /** 신고한 사람들. 일정 수가 넘으면 숨긴다. */
  @Prop({ type: [Types.ObjectId], default: [] })
  reportedBy!: Types.ObjectId[];

  @Prop({ required: true, default: false })
  hidden!: boolean;

  /** 지난주 결과 보상을 이미 받았다 */
  @Prop({ required: true, default: false })
  claimed!: boolean;

  createdAt!: Date;
}

export type ChallengeEntryDocument = HydratedDocument<ChallengeEntry>;
export const ChallengeEntrySchema = SchemaFactory.createForClass(ChallengeEntry);
ChallengeEntrySchema.index({ week: 1, userId: 1 }, { unique: true });
ChallengeEntrySchema.index({ week: 1, likes: -1, createdAt: 1 });
ChallengeEntrySchema.index({ createdAt: 1 }, { expireAfterSeconds: CHALLENGE_RETENTION_SECONDS });

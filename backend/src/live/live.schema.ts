import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 지급 장부: 보상 요청 하나(ref)당 한 번만 지급되게 한다. 일주일 뒤 지워진다. */
@Schema({ collection: 'live_rewards', timestamps: { createdAt: true, updatedAt: false } })
export class LiveReward {
  /** 소켓 서버가 정한 고유 값(방·사람). 같은 값은 다시 지급하지 않는다. */
  @Prop({ required: true })
  ref!: string;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  game!: string;

  /** 요청한 다이아 */
  @Prop({ required: true })
  want!: number;

  /** 실제로 지급한 다이아(하루 한도 적용). 처리 중이면 -1 */
  @Prop({ type: Number, default: -1 })
  granted!: number;
}

export type LiveRewardDocument = HydratedDocument<LiveReward>;
export const LiveRewardSchema = SchemaFactory.createForClass(LiveReward);
LiveRewardSchema.index({ ref: 1 }, { unique: true });
LiveRewardSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

/** 사람·한국 날짜별로 라이브 보상을 얼마 받았는지. 며칠 뒤 지워진다. */
@Schema({ collection: 'live_daily', minimize: false })
export class LiveDaily {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 한국 시간 날짜 YYYY-MM-DD */
  @Prop({ required: true })
  day!: string;

  /** 이날 받은 다이아 합계 */
  @Prop({ type: Number, default: 0 })
  total!: number;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type LiveDailyDocument = HydratedDocument<LiveDaily>;
export const LiveDailySchema = SchemaFactory.createForClass(LiveDaily);
LiveDailySchema.index({ userId: 1, day: 1 }, { unique: true });
LiveDailySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

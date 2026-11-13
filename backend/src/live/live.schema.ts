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

/** 가사 빈칸 속도전 최근 한 판(오래된 것부터 최대 10개). 고유 값(ref)은 같은 판을 두 번 쌓지 않으려고 둔다. */
@Schema({ _id: false })
export class LiveRecordGame {
  @Prop({ type: String, required: true })
  ref!: string;

  @Prop({ type: Number, required: true })
  at!: number;

  @Prop({ type: Number, required: true })
  rank!: number;

  @Prop({ type: Number, required: true })
  players!: number;

  @Prop({ type: Number, required: true })
  score!: number;

  @Prop({ type: Number, required: true })
  correct!: number;

  @Prop({ type: Number, required: true })
  rounds!: number;

  @Prop({ type: Boolean, required: true })
  multi!: boolean;
}
const LiveRecordGameSchema = SchemaFactory.createForClass(LiveRecordGame);

/** 사람·게임별 라이브 미니게임 내 기록. 진행 데이터라 정식 출시 같은 초기화 때 함께 비운다(`CLEAR_COLLECTIONS`). */
@Schema({ collection: 'live_records', minimize: false })
export class LiveRecord {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  game!: string;

  @Prop({ type: Number, default: 0 })
  games!: number;

  @Prop({ type: Number, default: 0 })
  multiGames!: number;

  @Prop({ type: Number, default: 0 })
  wins!: number;

  @Prop({ type: Number, default: 0 })
  totalCorrect!: number;

  @Prop({ type: Number, default: 0 })
  bestScore!: number;

  @Prop({ type: Number, default: 0 })
  bestCorrect!: number;

  @Prop({ type: [LiveRecordGameSchema], default: [] })
  recent!: LiveRecordGame[];
}

export type LiveRecordDocument = HydratedDocument<LiveRecord>;
export const LiveRecordSchema = SchemaFactory.createForClass(LiveRecord);
LiveRecordSchema.index({ userId: 1, game: 1 }, { unique: true });

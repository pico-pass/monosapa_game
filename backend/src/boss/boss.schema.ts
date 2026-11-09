import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 보관 기간. 지나면 MongoDB TTL 인덱스가 지운다. */
export const BOSS_RETENTION_SECONDS = 90 * 24 * 3600;
export const BOSS_LOG_RETENTION_SECONDS = 14 * 24 * 3600;

/** 한 주의 보스 기록. 주 번호가 유일하고, 그 주 처음 요청이 올 때 목표를 정해 만든다. */
@Schema({ collection: 'boss_weeks', timestamps: { createdAt: true, updatedAt: false } })
export class BossWeek {
  @Prop({ required: true, unique: true })
  week!: number;

  @Prop({ required: true })
  bossId!: string;

  /** 이번 주 목표 데미지 */
  @Prop({ required: true })
  target!: number;

  /** 모두가 지금까지 낸 데미지 합 */
  @Prop({ required: true, default: 0 })
  total!: number;

  /** 한 번이라도 때린 사람 수 */
  @Prop({ required: true, default: 0 })
  players!: number;

  createdAt!: Date;
}
export type BossWeekDocument = HydratedDocument<BossWeek>;
export const BossWeekSchema = SchemaFactory.createForClass(BossWeek);
BossWeekSchema.index({ createdAt: 1 }, { expireAfterSeconds: BOSS_RETENTION_SECONDS });

/** 한 사람의 한 주 기록. (주, 사람)이 유일하다. */
@Schema({ collection: 'boss_players', timestamps: { createdAt: true, updatedAt: false } })
export class BossPlayer {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  week!: number;

  @Prop({ required: true, default: 0 })
  damage!: number;

  @Prop({ required: true, default: 0 })
  hits!: number;

  /** 오늘(한국 시간 날짜)의 인정 타수. 날짜가 바뀌면 새로 센다. */
  @Prop({ required: true, default: '' })
  dayKey!: string;

  @Prop({ required: true, default: 0 })
  dayHits!: number;

  /** 마지막으로 인정된 타의 시각(ms) */
  @Prop({ required: true, default: 0 })
  lastHitAt!: number;

  /** 이번 주 단계 보상을 여기까지 받았다 */
  @Prop({ required: true, default: 0 })
  claimedTiers!: number;

  /** 주가 끝난 뒤 순위 보상을 받았다 */
  @Prop({ required: true, default: false })
  rankClaimed!: boolean;

  createdAt!: Date;
}
export type BossPlayerDocument = HydratedDocument<BossPlayer>;
export const BossPlayerSchema = SchemaFactory.createForClass(BossPlayer);
BossPlayerSchema.index({ week: 1, userId: 1 }, { unique: true });
BossPlayerSchema.index({ week: 1, damage: -1 });
BossPlayerSchema.index({ createdAt: 1 }, { expireAfterSeconds: BOSS_RETENTION_SECONDS });

/** 인정된 타 하나. (사람, 판 ID)가 유일해서 같은 판이 두 번 들어와도 한 번만 센다. 최근 타격 목록으로도 쓴다. */
@Schema({ collection: 'boss_logs', timestamps: { createdAt: true, updatedAt: false } })
export class BossLog {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  runId!: string;

  @Prop({ required: true })
  week!: number;

  @Prop({ required: true })
  kind!: string;

  @Prop({ required: true })
  damage!: number;

  createdAt!: Date;
}
export type BossLogDocument = HydratedDocument<BossLog>;
export const BossLogSchema = SchemaFactory.createForClass(BossLog);
BossLogSchema.index({ userId: 1, runId: 1 }, { unique: true });
BossLogSchema.index({ week: 1, createdAt: -1 });
BossLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: BOSS_LOG_RETENTION_SECONDS });

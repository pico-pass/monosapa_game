import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 보관 기간. 지나면 MongoDB TTL 인덱스가 지운다. */
export const CHART_CLAIM_RETENTION_SECONDS = 400 * 24 * 3600;

/** 차트 순위 보상을 받은 기록. 사람마다 하루(한국 시간)에 한 번만 받는다. */
@Schema({ collection: 'chart_claims', timestamps: { createdAt: true, updatedAt: false } })
export class ChartClaim {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /** 한국 시간 날짜 YYYY-MM-DD */
  @Prop({ required: true })
  day!: string;

  @Prop({ required: true })
  rank!: number;

  createdAt!: Date;
}

export type ChartClaimDocument = HydratedDocument<ChartClaim>;
export const ChartClaimSchema = SchemaFactory.createForClass(ChartClaim);
ChartClaimSchema.index({ userId: 1, day: 1 }, { unique: true });
ChartClaimSchema.index({ createdAt: 1 }, { expireAfterSeconds: CHART_CLAIM_RETENTION_SECONDS });

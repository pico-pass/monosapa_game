import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 끝난 교환(완료·취소)을 지우는 기간. 열려 있거나 수령 대기 중인 교환은 지우지 않는다. */
export const TRADE_DONE_RETENTION_SECONDS = 30 * 24 * 3600;

export type TradeStatus = 'open' | 'taken' | 'done' | 'cancelled';

/**
 * 포토카드 교환 하나. 올린 사람의 카드(give)는 이미 올린 사람의 게임 저장에서 빠진 채 여기 맡겨져 있고(에스크로),
 * 가져가는 사람이 원하는 카드(want)를 내면 서로의 카드가 바뀐다. 서버는 상태 전이만 보증하고 카드 보유는 믿는다.
 */
@Schema({ collection: 'trades', timestamps: { createdAt: true, updatedAt: false } })
export class Trade {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  give!: string;

  @Prop({ required: true })
  want!: string;

  /** open 열림 → taken 누가 가져감(올린 사람이 want를 받으러 와야 함) → done 수령 완료 / cancelled 올린 사람이 거둠 */
  @Prop({ type: String, required: true, default: 'open', index: true })
  status!: TradeStatus;

  @Prop({ type: Types.ObjectId, default: null })
  takerId!: Types.ObjectId | null;

  /** done·cancelled가 된 시각. 이 값이 있는 문서만 TTL로 지워진다. */
  @Prop({ type: Date, default: null })
  doneAt!: Date | null;

  createdAt!: Date;
}

export type TradeDocument = HydratedDocument<Trade>;
export const TradeSchema = SchemaFactory.createForClass(Trade);
TradeSchema.index({ doneAt: 1 }, { expireAfterSeconds: TRADE_DONE_RETENTION_SECONDS });

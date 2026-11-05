import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 보관 기간. 지나면 MongoDB TTL 인덱스가 지운다. */
export const DM_RETENTION_SECONDS = 14 * 24 * 3600;

/** 친구끼리의 개인채팅 메시지 하나. 방은 두 계정 ID를 묶은 `pair` 키로 구분한다. */
@Schema({ collection: 'direct_messages', timestamps: { createdAt: true, updatedAt: false } })
export class DirectMessage {
  @Prop({ required: true })
  pair!: string;

  @Prop({ type: Types.ObjectId, required: true })
  from!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  to!: Types.ObjectId;

  @Prop({ required: true })
  text!: string;

  /** 받은 사람이 읽은 시각(안 읽었으면 null) */
  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  createdAt!: Date;
}

export type DirectMessageDocument = HydratedDocument<DirectMessage>;
export const DirectMessageSchema = SchemaFactory.createForClass(DirectMessage);
DirectMessageSchema.index({ pair: 1, _id: -1 });
DirectMessageSchema.index({ to: 1, readAt: 1 });
DirectMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: DM_RETENTION_SECONDS });

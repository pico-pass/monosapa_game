import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 보관 기간. 지나면 MongoDB TTL 인덱스가 지운다. */
export const CHAT_RETENTION_SECONDS = 14 * 24 * 3600;

/** 공개 챗방의 메시지 하나. 이름·사진은 보낸 시점의 구글 프로필을 그대로 둔다. */
@Schema({ collection: 'chat_messages', timestamps: { createdAt: true, updatedAt: false } })
export class ChatMessage {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: String, default: null })
  picture!: string | null;

  /** 보낸 사람이 달고 있는 칭호(게임 안 꾸미기, 클라이언트가 보낸 문구 그대로) */
  @Prop({ type: String, default: null })
  title!: string | null;

  @Prop({ required: true })
  text!: string;

  createdAt!: Date;
}

export type ChatMessageDocument = HydratedDocument<ChatMessage>;
export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
ChatMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: CHAT_RETENTION_SECONDS });

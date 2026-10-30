import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 로그인 세션. 쿠키에는 원본 토큰만 있고, DB에는 SHA-256 해시만 둔다. 만료되면 MongoDB TTL 인덱스가 지운다. */
@Schema({ collection: 'sessions', timestamps: { createdAt: true, updatedAt: false } })
export class Session {
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt!: Date;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);

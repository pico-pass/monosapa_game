import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 우편의 종류: 친구의 선물 · 운영자가 보낸 우편 · 운영 경고·이용 제한 안내 · 신고 처리 결과 */
export const MAIL_KINDS = ['gift', 'admin', 'warning', 'report'] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** 우편이 남아 있는 기간. 지나면 MongoDB TTL 인덱스가 지운다(받지 않은 다이아도 함께 사라진다). */
export const MAIL_RETENTION_DAYS = 30;

/** 우편함의 우편 하나. 다이아가 붙은 우편은 받기를 눌러야 반영된다(한 번만). */
@Schema({ collection: 'mails', timestamps: { createdAt: true, updatedAt: false } })
export class Mail {
  /** 받는 사람 */
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, enum: MAIL_KINDS })
  kind!: MailKind;

  @Prop({ required: true })
  title!: string;

  @Prop({ type: String, default: '' })
  body!: string;

  /** 붙어 있는 다이아(없으면 0) */
  @Prop({ type: Number, default: 0 })
  diamonds!: number;

  /** 다이아를 받았는가 */
  @Prop({ type: Boolean, default: false })
  claimed!: boolean;

  /** 우편함을 열어 봤는가 */
  @Prop({ type: Boolean, default: false })
  read!: boolean;

  /** 보낸 사람(선물). 운영자 우편·안내는 비어 있다. */
  @Prop({ type: Types.ObjectId, default: null })
  fromUid!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  fromName!: string | null;

  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt!: Date;

  createdAt!: Date;
}

export type MailDocument = HydratedDocument<Mail>;
export const MailSchema = SchemaFactory.createForClass(Mail);
MailSchema.index({ userId: 1, _id: -1 });

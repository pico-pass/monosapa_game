import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 우편의 종류: 친구의 선물 · 운영자가 보낸 우편 · 운영 경고·이용 제한 안내 · 신고 처리 결과 · 라이브 미니게임 보상 · 정식 출시 보상 */
export const MAIL_KINDS = ['gift', 'admin', 'warning', 'report', 'live', 'launch'] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** 우편이 남아 있는 기간. 지나면 MongoDB TTL 인덱스가 지운다(받지 않은 다이아도 함께 사라진다). */
export const MAIL_RETENTION_DAYS = 30;

/** 우편함의 우편 하나. 다이아·코인이 붙은 우편은 받기를 눌러야 반영된다(한 번만). */
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

  /** 붙어 있는 코인(없으면 0). 예전 우편에는 이 필드가 없다. */
  @Prop({ type: Number, default: 0 })
  coins!: number;

  /** 붙은 보상(다이아·코인)을 받았는가 */
  @Prop({ type: Boolean, default: false })
  claimed!: boolean;

  /** 같은 우편을 두 번 만들지 않게 하는 키(출시 보상 등). 보통 우편에는 없다. */
  @Prop({ type: String, default: undefined })
  ref?: string;

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
MailSchema.index({ ref: 1 }, { unique: true, partialFilterExpression: { ref: { $type: 'string' } } });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

export const INQUIRY_CATEGORIES = ['bug', 'idea', 'account', 'other'] as const;
export type InquiryCategory = (typeof INQUIRY_CATEGORIES)[number];
export type InquiryStatus = 'open' | 'answered';

/** 문의함의 문의 하나. 보낸 사람의 이름·이메일은 관리자가 연락할 수 있게 접수 시점 값을 그대로 둔다. */
@Schema({ collection: 'inquiries', timestamps: { createdAt: true, updatedAt: false } })
export class Inquiry {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, default: null })
  userName!: string | null;

  @Prop({ type: String, default: null })
  userEmail!: string | null;

  @Prop({ required: true, enum: INQUIRY_CATEGORIES })
  category!: InquiryCategory;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ required: true, enum: ['open', 'answered'], default: 'open', index: true })
  status!: InquiryStatus;

  @Prop({ type: String, default: null })
  reply!: string | null;

  @Prop({ type: Date, default: null })
  repliedAt!: Date | null;

  createdAt!: Date;
}

export type InquiryDocument = HydratedDocument<Inquiry>;
export const InquirySchema = SchemaFactory.createForClass(Inquiry);
InquirySchema.index({ status: 1, createdAt: -1 });

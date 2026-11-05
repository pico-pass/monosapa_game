import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

export const REPORT_KINDS = ['profile', 'chat', 'dm'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_REASONS = ['abuse', 'spam', 'sexual', 'hate', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REASON_TEXT: Record<ReportReason, string> = {
  abuse: '욕설·비방',
  spam: '도배·광고',
  sexual: '음란·불쾌한 내용',
  hate: '혐오·차별',
  other: '기타',
};

export type ReportStatus = 'open' | 'done';
export const REPORT_ACTIONS = ['dismiss', 'warn', 'mute'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/** 신고 하나. 신고 당시의 내용을 `snapshot`에 그대로 남겨서, 메시지가 지워지거나 프로필이 바뀌어도 관리자가 확인할 수 있다. */
@Schema({ collection: 'reports', timestamps: { createdAt: true, updatedAt: false } })
export class Report {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  reporter!: Types.ObjectId;

  /** 신고당한 계정 */
  @Prop({ type: Types.ObjectId, required: true, index: true })
  target!: Types.ObjectId;

  @Prop({ required: true, enum: REPORT_KINDS })
  kind!: ReportKind;

  /** 신고한 대상: 챗방·개인채팅은 메시지 ID, 프로필은 신고당한 계정 ID */
  @Prop({ required: true })
  refId!: string;

  @Prop({ required: true, enum: REPORT_REASONS })
  reason!: ReportReason;

  @Prop({ type: String, default: '' })
  detail!: string;

  /** 신고 당시 내용: 메시지 글, 또는 프로필의 닉네임·소개 */
  @Prop({ required: true })
  snapshot!: string;

  /** 개인채팅 신고에서 앞선 대화 몇 줄 */
  @Prop({ type: [String], default: [] })
  context!: string[];

  @Prop({ required: true, enum: ['open', 'done'], default: 'open' })
  status!: ReportStatus;

  @Prop({ type: String, enum: [...REPORT_ACTIONS, null], default: null })
  action!: ReportAction | null;

  /** 처리한 관리자의 메모. 경고·제재에서는 당사자에게 가는 우편에도 들어간다. */
  @Prop({ type: String, default: '' })
  note!: string;

  /** 이용 제한을 건 시간 */
  @Prop({ type: Number, default: 0 })
  muteHours!: number;

  @Prop({ type: Types.ObjectId, default: null })
  handledBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  handledAt!: Date | null;

  createdAt!: Date;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index({ status: 1, _id: 1 });
// 같은 사람이 같은 대상을 처리 전에 또 신고하지 못한다(처리된 뒤에는 다시 신고할 수 있다).
ReportSchema.index({ reporter: 1, kind: 1, refId: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });

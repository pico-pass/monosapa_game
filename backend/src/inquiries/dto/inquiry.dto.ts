import type { InquiryCategory, InquiryStatus } from '../inquiry.schema.js';

/** POST /api/inquiries 요청 */
export class CreateInquiryDto {
  category!: InquiryCategory;
  title!: string;
  body!: string;
}

/** POST /api/inquiries/:id/reply 요청 (관리자) */
export class ReplyInquiryDto {
  text!: string;
}

export class InquiryDto {
  id!: string;
  category!: InquiryCategory;
  title!: string;
  body!: string;
  status!: InquiryStatus;
  reply!: string | null;
  /** 접수 시각(ms) */
  createdAt!: number;
  repliedAt!: number | null;
  /** 보낸 사람. 관리자 목록에서만 채워진다. */
  from?: { name: string | null; email: string | null };
}

export class InquiryListDto {
  inquiries!: InquiryDto[];
}

import type { MailKind } from '../mail.schema.js';

export class MailDto {
  id!: string;
  kind!: MailKind;
  title!: string;
  body!: string;
  diamonds!: number;
  /** 붙어 있는 코인 */
  coins!: number;
  claimed!: boolean;
  read!: boolean;
  fromName!: string | null;
  /** 받은 시각(ms) */
  at!: number;
  /** 사라지는 시각(ms) */
  expiresAt!: number;
}

/** GET /api/mailbox 응답. 최근 우편부터 */
export class MailboxDto {
  mails!: MailDto[];
  /** 아직 열어 보지 않은 우편 수 */
  unread!: number;
  /** 받지 않은 보상(다이아·코인)이 붙은 우편 수 */
  claimable!: number;
}

/** 받기 응답. 반영은 클라이언트가 한다. */
export class MailClaimDto {
  diamonds!: number;
  coins!: number;
  /** 받은 우편 수 */
  count!: number;
}

/** POST /api/mailbox/admin/send 요청 (관리자) */
export class AdminMailDto {
  /** 'all' 이면 모든 계정, 아니면 받는 사람의 계정 ID(uid) */
  to!: string;
  title!: string;
  body!: string;
  /** 붙일 다이아(0~) */
  diamonds?: number;
}

export class AdminMailResultDto {
  sent!: number;
}

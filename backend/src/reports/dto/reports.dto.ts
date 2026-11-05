import type { ReportAction, ReportKind, ReportReason, ReportStatus } from '../report.schema.js';

/** POST /api/reports 요청 */
export class CreateReportDto {
  kind!: ReportKind;
  /** 챗방·개인채팅이면 메시지 ID */
  refId?: string;
  /** 프로필이면 신고할 계정 ID */
  uid?: string;
  reason!: ReportReason;
  detail?: string;
}

/** POST /api/reports/admin/:id/resolve 요청 (관리자) */
export class ResolveReportDto {
  action!: ReportAction;
  /** 처리 메모(경고·제재에서는 필수, 당사자에게 우편으로 간다) */
  note?: string;
  /** action 이 mute 일 때 이용 제한 시간(1~8760시간, 기본 24) */
  muteHours?: number;
}

export class UnmuteDto {
  uid!: string;
}

class WhoDto {
  uid!: string;
  name!: string;
}

export class ReportDto {
  id!: string;
  kind!: ReportKind;
  reason!: ReportReason;
  reasonText!: string;
  detail!: string;
  snapshot!: string;
  context!: string[];
  reporter!: WhoDto;
  target!: WhoDto & {
    /** 이용 제한이 풀리는 시각(ms), 제한 중이 아니면 null */
    mutedUntil: number | null;
    /** 이 계정에 들어온 신고 전체 수(처리한 것 포함) */
    totalReports: number;
  };
  status!: ReportStatus;
  action!: ReportAction | null;
  note!: string;
  muteHours!: number;
  handledBy!: string | null;
  handledAt!: number | null;
  createdAt!: number;
}

export class ReportListDto {
  reports!: ReportDto[];
}

export class MutedUserDto {
  uid!: string;
  name!: string;
  until!: number;
}

export class MutedListDto {
  users!: MutedUserDto[];
}

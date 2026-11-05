import type { ReportAction } from './report.schema.js';

/*
 * 신고를 처리한 결과로 당사자·신고자에게 가는 우편의 글. 순수 함수라 서버 없이 테스트한다.
 */

const HOUR_MS = 3600_000;
/** 한국 시간 YYYY-MM-DD HH:MM */
export const kst = (ms: number): string => new Date(ms + 9 * HOUR_MS).toISOString().slice(0, 16).replace('T', ' ');

/** 경고를 받는 당사자에게 가는 우편 */
export function warnMail(reason: string, note: string): { title: string; body: string } {
  return { title: '⚠️ 운영 경고', body: `신고가 접수되어 확인한 결과, 이용 규칙에 어긋나는 내용이 있어 조치했어요.\n사유: ${reason}\n운영자 안내: ${note}` };
}

/** 이용 제한을 받는 당사자에게 가는 우편 */
export function muteMail(reason: string, note: string, hours: number, until: number): { title: string; body: string } {
  return {
    title: '🚫 이용 제한 안내',
    body: `신고가 접수되어 확인한 결과, ${hours}시간 동안 챗방 글쓰기·개인채팅·프로필 수정이 제한돼요. (한국 시간 ${kst(until)}까지)\n사유: ${reason}\n운영자 안내: ${note}`,
  };
}

/** 신고한 사람에게 가는 처리 결과 우편 */
export function reporterMail(action: ReportAction): { title: string; body: string } {
  return {
    title: '📢 신고 처리 결과',
    body: action === 'dismiss' ? '신고해 주신 내용을 확인했지만 이용 규칙 위반으로 보기 어려워 조치하지 않았어요.' : '신고해 주신 내용을 확인해 조치했어요. 신고해 주셔서 고마워요.',
  };
}


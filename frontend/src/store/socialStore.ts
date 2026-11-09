import { useSyncExternalStore } from 'react';
import { api } from '../platform/api';
import { setTab } from './gameStore';

/*
 * 친구·우편함·개인채팅의 화면 밖 상태: 새 소식 개수(알림 점), 지금 열려 있는 프로필·신고창, 열려 있는 개인채팅 상대.
 * 개수는 서버(GET /api/social/summary)에서 주기적으로 가져온다.
 */

export interface SocialSummary {
  /** 아직 열어 보지 않은 우편 수 */
  mailUnread: number;
  /** 받지 않은 다이아가 붙은 우편 수 */
  mailClaimable: number;
  /** 나에게 온 친구 요청 수 */
  friendRequests: number;
  /** 안 읽은 개인채팅 메시지 수 */
  dmUnread: number;
  /** 친구가 꽂아 줘서 아직 받지 않은 마을 깃발 수 */
  villageFlags: number;
  /** 월드 보스에서 받을 수 있는 보상(이번 주 단계 + 지난주 순위) 수 */
  bossClaimable: number;
}

/** 신고창이 가리키는 대상 */
export interface ReportTarget {
  kind: 'chat' | 'dm' | 'profile';
  /** 챗방·개인채팅이면 메시지 ID */
  refId?: string;
  /** 프로필이면 신고할 계정 ID */
  uid?: string;
  /** 신고창에 보여 줄 이름 */
  label: string;
}

interface SocialState {
  summary: SocialSummary;
  profile: { uid: string; edit: boolean } | null;
  report: ReportTarget | null;
  dmWith: string | null;
}

export const EMPTY_SUMMARY: SocialSummary = { mailUnread: 0, mailClaimable: 0, friendRequests: 0, dmUnread: 0, villageFlags: 0, bossClaimable: 0 };

let state: SocialState = { summary: EMPTY_SUMMARY, profile: null, report: null, dmWith: null };
const listeners = new Set<() => void>();
function set(patch: Partial<SocialState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useSocial = (): SocialState => useSyncExternalStore(subscribe, () => state, () => state);
export const getSocial = (): SocialState => state;

/** 우편함 알림: 안 읽은 우편과 받을 다이아가 있는 우편 중 큰 쪽 */
export const mailBadge = (s: SocialSummary): number => Math.max(s.mailUnread, s.mailClaimable);
/** 친구 알림: 받은 요청 + 안 읽은 개인채팅 */
export const friendBadge = (s: SocialSummary): number => s.friendRequests + s.dmUnread;
/** 더보기 탭의 알림 점에 더해지는 개수 */
export const socialTotal = (s: SocialSummary): number => mailBadge(s) + friendBadge(s) + s.villageFlags + s.bossClaimable;

/** 새 소식 개수를 다시 가져온다. 실패하면 이전 값을 그대로 둔다. */
export async function refreshSummary(): Promise<void> {
  try {
    set({ summary: await api<SocialSummary>('social/summary') });
  } catch {
    /* 알림 점이 늦게 갱신될 뿐이다 */
  }
}

const POLL_MS = 30_000;

/** 게임 화면이 떠 있는 동안 30초마다(화면이 보일 때만) 새 소식 개수를 가져온다. */
export function startSocial(): () => void {
  const tick = () => {
    if (document.visibilityState === 'visible') void refreshSummary();
  };
  tick();
  const id = setInterval(tick, POLL_MS);
  document.addEventListener('visibilitychange', tick);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', tick);
  };
}

export const openProfile = (uid: string, edit = false): void => set({ profile: { uid, edit } });
export const closeProfile = (): void => set({ profile: null });
export const openReport = (target: ReportTarget): void => set({ report: target });
export const closeReport = (): void => set({ report: null });

/** 친구와의 개인채팅 화면을 연다. */
export function openDm(uid: string): void {
  set({ dmWith: uid, profile: null });
  setTab('dm');
}

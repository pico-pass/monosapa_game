import { useSyncExternalStore } from 'react';
import { syncBeforeLeave } from './gameStore';

/* 구글 로그인 상태. 로그인해야 게임이 시작되고, 진행 데이터는 이 계정에 저장된다. */

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  /** 관리자 계정(문의 답변·챗방 메시지 삭제). 서버가 정한다. */
  isAdmin?: boolean;
}

export interface AuthState {
  /** loading: 확인 중 · ready: 로그인 가능(또는 로그인됨) · unavailable: 서버에 닿지 않거나 구글 로그인이 설정되지 않음 */
  status: 'loading' | 'ready' | 'unavailable';
  /** 구글 OAuth 웹 클라이언트 ID (공개 값, 서버가 내려준다) */
  clientId: string;
  user: AuthUser | null;
  busy: boolean;
  error: string | null;
}

let state: AuthState = { status: 'loading', clientId: '', user: null, busy: false, error: null };
const listeners = new Set<() => void>();
function set(patch: Partial<AuthState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useAuth = (): AuthState => useSyncExternalStore(subscribe, () => state);

const TIMEOUT_MS = 8000;

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const res = await fetch(`/api/auth/${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'Content-Type': 'application/json' } });
  const body = res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null);
  return { status: res.status, body };
}

let started = false;
/** 앱이 뜰 때 한 번: 구글 클라이언트 ID와 현재 로그인 사용자를 서버에서 가져온다. */
export async function initAuth(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const cfg = await api<{ googleClientId: string }>('config');
    const clientId = cfg.body?.googleClientId ?? '';
    if (cfg.status !== 200 || !clientId) {
      set({ status: 'unavailable' });
      return;
    }
    const me = await api<{ user: AuthUser | null }>('me');
    set({ status: 'ready', clientId, user: me.status === 200 ? (me.body?.user ?? null) : null });
  } catch {
    set({ status: 'unavailable' });
  }
}

/** 로그인 화면의 "다시 시도". 서버에 닿지 않았을 때 한 번 더 확인한다. */
export async function retryAuth(): Promise<void> {
  started = false;
  set({ status: 'loading', error: null });
  await initAuth();
}

/** 구글 버튼이 돌려준 ID 토큰을 서버에 보내 로그인한다. */
export async function signInWithGoogle(credential: string): Promise<void> {
  set({ busy: true, error: null });
  try {
    const r = await api<{ user: AuthUser }>('google', { method: 'POST', body: JSON.stringify({ credential }) });
    if (r.status === 200 && r.body?.user) set({ user: r.body.user, busy: false });
    else set({ busy: false, error: r.status === 401 ? '구글 로그인 확인에 실패했어요. 다시 시도해 주세요.' : '로그인에 실패했어요. 잠시 뒤 다시 시도해 주세요.' });
  } catch {
    set({ busy: false, error: '서버에 연결하지 못했어요.' });
  }
}

export async function signOut(): Promise<void> {
  set({ busy: true, error: null });
  try {
    await syncBeforeLeave().catch(() => {}); // 못 올린 진행이 있으면 로그아웃 전에 서버에 올린다
    await api<null>('logout', { method: 'POST' });
    // 게임 틱·배경음악·저장 잠금이 모두 멈추도록 새로 불러온다. 다시 열면 로그인 화면부터 나온다.
    window.location.reload();
  } catch {
    set({ busy: false, error: '로그아웃하지 못했어요. 다시 시도해 주세요.' });
  }
}

import { api } from './api';

/*
 * 정식 출시 환영 팝업의 서버 연동과 「하루 동안 보지 않기」 기억.
 * 출시 여부·기간·패키지 내용은 서버가 정한다(backend/src/launch). 화면은 받은 값을 보여 줄 뿐이다.
 */

export interface LaunchInfo {
  /** 정식 출시 초기화가 끝났는가 */
  launched: boolean;
  epoch: number;
  launchedAt: number | null;
  /** 환영 팝업을 보여 줄 기간인가 */
  popup: boolean;
  starter: { coins: number; diamonds: number };
  /** 이번 호출로 스타트 패키지 우편이 새로 왔는가 */
  granted: boolean;
}

export const HIDE_DAY_MS = 86_400_000;
const hideKey = (uid: string) => `monosapa.launch.hideUntil:${uid}`;

/** 게임에 들어왔다고 서버에 알리고 출시 상태를 받는다. 실패하면 null(팝업은 뜨지 않는다). */
export async function enterLaunch(): Promise<LaunchInfo | null> {
  try {
    return await api<LaunchInfo>('launch/enter', { method: 'POST' });
  } catch {
    return null;
  }
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** 팝업을 숨겨 둔 시각(ms). 기억이 없거나 저장소가 막혀 있으면 0. */
export function readHideUntil(store: Store | null, uid: string): number {
  try {
    const n = Number(store?.getItem(hideKey(uid)));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** 「하루 동안 보지 않기」: 지금부터 24시간 동안 숨긴다. */
export function hideForOneDay(store: Store | null, uid: string, now: number): void {
  try {
    store?.setItem(hideKey(uid), String(now + HIDE_DAY_MS));
  } catch {
    /* 기억하지 못하면 다음 접속에 다시 보일 뿐이다 */
  }
}

/** 팝업을 띄울지: 출시했고 보여 줄 기간이며 숨겨 둔 시간이 지났다. */
export function shouldShowLaunchPopup(info: LaunchInfo | null, hideUntil: number, now: number): boolean {
  return !!info && info.launched && info.popup && now >= hideUntil;
}

export function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

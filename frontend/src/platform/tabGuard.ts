/**
 * 쓰기 탭을 하나로 제한한다. Web Locks가 있으면 잠금을, 없으면 BroadcastChannel 핑으로 판단한다.
 * 이것은 두 탭이 같은 저장을 덮어쓰는 사고를 줄이는 UX 장치일 뿐 보안 장치가 아니다.
 */

const LOCK_NAME = 'monosapa-writer';
const CHANNEL_NAME = 'monosapa-tabs';
const PING_WAIT_MS = 350;
const TAKEOVER_WAIT_MS = 400;

type Msg = { t: 'who'; from: string } | { t: 'active'; to: string } | { t: 'takeover' } | { t: 'released' };

const tabId = Math.random().toString(36).slice(2);
let channel: BroadcastChannel | null = null;
let isWriter = false;
let releaseLock: (() => void) | null = null;
let onLost: (() => void) | null = null;
let onTakeoverRequest: (() => void) | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (ev: MessageEvent<Msg>) => {
    const m = ev.data;
    if (m.t === 'who' && isWriter) channel?.postMessage({ t: 'active', to: m.from } satisfies Msg);
    if (m.t === 'takeover' && isWriter) {
      onTakeoverRequest?.();
      loseWriter();
      channel?.postMessage({ t: 'released' } satisfies Msg);
    }
  };
  return channel;
}

function loseWriter(): void {
  if (!isWriter) return;
  isWriter = false;
  releaseLock?.();
  releaseLock = null;
  onLost?.();
}

export function setGuardHandlers(handlers: { onLost: () => void; onTakeoverRequest: () => void }): void {
  onLost = handlers.onLost;
  onTakeoverRequest = handlers.onTakeoverRequest;
}

const hasLocks = () => typeof navigator !== 'undefined' && 'locks' in navigator;

function requestLock(steal: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    navigator.locks
      .request(LOCK_NAME, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        isWriter = true;
        resolve(true);
        return new Promise<void>((release) => {
          releaseLock = release;
        });
      })
      .catch(() => {
        // 다른 탭이 잠금을 가져가면 AbortError로 끝난다.
        if (isWriter) loseWriter();
      });
  });
}

/** 쓰기 권한을 얻으려 시도한다. 이미 다른 탭이 쓰고 있으면 false. */
export async function acquireWriter(): Promise<boolean> {
  getChannel();
  if (hasLocks()) return requestLock(false);
  const ch = getChannel();
  if (!ch) {
    isWriter = true;
    return true;
  }
  const answered = await new Promise<boolean>((resolve) => {
    const handler = (ev: MessageEvent<Msg>) => {
      if (ev.data.t === 'active' && ev.data.to === tabId) {
        ch.removeEventListener('message', handler);
        resolve(true);
      }
    };
    ch.addEventListener('message', handler);
    ch.postMessage({ t: 'who', from: tabId } satisfies Msg);
    setTimeout(() => {
      ch.removeEventListener('message', handler);
      resolve(false);
    }, PING_WAIT_MS);
  });
  if (answered) return false;
  isWriter = true;
  return true;
}

/** 읽기 전용 탭에서 "이 탭에서 계속하기": 쓰던 탭이 저장하고 물러난 뒤 쓰기 권한을 가져온다. */
export async function takeOverWriter(): Promise<boolean> {
  const ch = getChannel();
  if (ch) {
    await new Promise<void>((resolve) => {
      const handler = (ev: MessageEvent<Msg>) => {
        if (ev.data.t === 'released') {
          ch.removeEventListener('message', handler);
          resolve();
        }
      };
      ch.addEventListener('message', handler);
      ch.postMessage({ t: 'takeover' } satisfies Msg);
      setTimeout(() => {
        ch.removeEventListener('message', handler);
        resolve();
      }, TAKEOVER_WAIT_MS);
    });
  }
  if (hasLocks()) return requestLock(true);
  isWriter = true;
  return true;
}

export const writerActive = () => isWriter;

import { useEffect, useRef, useState } from 'react';
import { openLive, type ClientMsg, type LiveClient, type ServerMsg } from '../../platform/live';
import type { LiveGame } from '../../../../realtime/src/protocol';

export type LiveStatus = 'connecting' | 'open' | 'closed' | 'replaced' | 'failed';

/**
 * 라이브 게임 연결 훅. 열리면 바로 그 게임에 들어가고(join), 화면을 떠나면 연결을 닫는다.
 * onMessage는 매 렌더마다 바뀌어도 된다(최신 것을 부른다). retry()를 부르면 처음부터 다시 연결한다.
 */
export function useLive(game: LiveGame, onMessage: (msg: ServerMsg) => void): { status: LiveStatus; send: (msg: ClientMsg) => void; retry: () => void } {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [attempt, setAttempt] = useState(0);
  const client = useRef<LiveClient | null>(null);
  const cb = useRef(onMessage);
  useEffect(() => {
    cb.current = onMessage;
  });

  useEffect(() => {
    setStatus('connecting');
    const c = openLive({
      onOpen: () => {
        setStatus('open');
        c.send({ t: 'join', game });
      },
      onMessage: (m) => cb.current(m),
      onClose: ({ code, wasOpen }) => setStatus(code === 4001 ? 'replaced' : wasOpen ? 'closed' : 'failed'),
    });
    client.current = c;
    return () => {
      c.close();
      client.current = null;
    };
  }, [game, attempt]);

  return { status, send: (msg) => client.current?.send(msg), retry: () => setAttempt((n) => n + 1) };
}

/** 지금 시각(ms)을 interval마다 갱신해서 돌려준다(카운트다운 표시용). active가 거짓이면 멈춘다. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(performance.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

export const STATUS_TEXT: Record<Exclude<LiveStatus, 'open' | 'connecting'>, string> = {
  closed: '연결이 끊겼어요.',
  replaced: '다른 창에서 접속해서 이 화면은 끊겼어요.',
  failed: '라이브 서버에 연결하지 못했어요. 로그인이 풀렸거나 서버가 점검 중일 수 있어요.',
};

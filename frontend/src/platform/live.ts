/*
 * 라이브 미니게임 소켓 연결(별도 소켓 서버 `realtime/`, 주소 /rt). 로그인 쿠키가 그대로 실려 가서 서버가 누구인지 안다.
 * 메시지 모양은 소켓 서버와 같은 파일(realtime/src/protocol.ts)의 타입을 쓴다.
 */
import type { ClientMsg, ServerMsg } from '../../../realtime/src/protocol';

export type { ClientMsg, ServerMsg };

export interface LiveHandlers {
  onOpen?: () => void;
  onMessage: (msg: ServerMsg) => void;
  /** 연결이 닫혔다. wasOpen이 거짓이면 연결 자체를 못 한 것(로그인 풀림·서버 꺼짐 등). code 4001은 다른 창에서 접속해 밀려난 것. */
  onClose: (info: { code: number; wasOpen: boolean }) => void;
}

export interface LiveClient {
  send: (msg: ClientMsg) => void;
  close: () => void;
}

/** 지금 페이지와 같은 호스트의 /rt (https면 wss) */
export const liveUrl = (loc: Pick<Location, 'protocol' | 'host'> = location): string => `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/rt`;

export function openLive(h: LiveHandlers, url = liveUrl()): LiveClient {
  const ws = new WebSocket(url);
  let opened = false;
  ws.onopen = () => {
    opened = true;
    h.onOpen?.();
  };
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    try {
      h.onMessage(JSON.parse(e.data) as ServerMsg);
    } catch {
      // 이상한 메시지는 무시한다
    }
  };
  ws.onclose = (e) => h.onClose({ code: e.code, wasOpen: opened });
  return {
    send: (msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close: () => {
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
    },
  };
}

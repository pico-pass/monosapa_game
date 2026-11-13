/*
 * 소켓 서버: HTTP 업그레이드에서 로그인·출처를 확인하고, 메시지를 읽어 허브에 넘긴다.
 * 메시지 속도 제한, 큰 메시지 거부, 한 계정 한 접속(새 접속이 옛 접속을 대체), 끊긴 접속 정리를 여기서 한다.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { Hub, type Conn, type RecordSink, type RewardSink } from './hub.js';
import { parseClientMsg, type ServerMsg } from './protocol.js';
import type { AuthFn } from './remote.js';

export interface ServerDeps {
  auth: AuthFn;
  rewards: RewardSink;
  /** 가사 빈칸 속도전 판 기록 저장(없으면 기록은 남기지 않는다) */
  records?: RecordSink;
  lines: readonly string[];
  path?: string;
  maxConns?: number;
  now?: () => number;
  seed?: () => number;
  /** false 로 두면 허브의 시계를 직접 돌린다(테스트) */
  autoTick?: boolean;
  log?: (msg: string) => void;
}

export interface RealtimeServer {
  server: Server;
  hub: Hub;
  close(): Promise<void>;
}

/** 초당 메시지 수 제한(토큰 통): 팬덤 조종이 초당 20번쯤 오므로 넉넉하게 */
const RATE_PER_SEC = 60;
const RATE_BURST = 90;
const MAX_PAYLOAD = 1024;
const HEARTBEAT_MS = 25_000;
/** 서버가 보낼 것이 이만큼 밀려 있으면 스냅샷은 건너뛴다 */
const BACKLOG_LIMIT = 512 * 1024;

/** 브라우저의 Origin 이 접속한 호스트와 같은 곳이다 */
export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createRealtimeServer(deps: ServerDeps): RealtimeServer {
  const now = deps.now ?? Date.now;
  const path = deps.path ?? '/rt';
  const maxConns = deps.maxConns ?? 400;
  const hub = new Hub({ rewards: deps.rewards, records: deps.records, lines: deps.lines, seed: deps.seed, log: deps.log });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  const live = new Map<string, { ws: WebSocket; conn: Conn }>();
  const alive = new WeakMap<WebSocket, boolean>();

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === `${path}/health`) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok', ...hub.stats }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== path) return reject(socket, 404, 'Not Found');
    if (!sameOrigin(req.headers.origin, req.headers.host)) return reject(socket, 403, 'Forbidden');
    if (wss.clients.size >= maxConns) return reject(socket, 503, 'Service Unavailable');
    deps
      .auth(req.headers.cookie)
      .then((user) => {
        if (!user) return reject(socket, 401, 'Unauthorized');
        if (socket.destroyed) return;
        wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, user));
      })
      .catch((e: unknown) => {
        deps.log?.(`로그인 확인 실패: ${e instanceof Error ? e.message : String(e)}`);
        reject(socket, 503, 'Service Unavailable');
      });
  });

  function onConnection(ws: WebSocket, user: { uid: string; name: string }): void {
    const conn: Conn = {
      uid: user.uid,
      name: user.name,
      send(msg: ServerMsg) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (msg.t === 'f.s' && ws.bufferedAmount > BACKLOG_LIMIT) return;
        ws.send(JSON.stringify(msg));
      },
    };
    const old = live.get(user.uid);
    if (old) {
      hub.disconnect(old.conn, now());
      old.ws.close(4001, 'replaced');
    }
    live.set(user.uid, { ws, conn });
    alive.set(ws, true);
    hub.connect(conn);

    let tokens = RATE_BURST;
    let last = now();
    ws.on('message', (data, isBinary) => {
      const t = now();
      tokens = Math.min(RATE_BURST, tokens + ((t - last) / 1000) * RATE_PER_SEC);
      last = t;
      if (isBinary) return;
      if (tokens < 1) return conn.send({ t: 'err', code: 'rate' });
      tokens -= 1;
      const msg = parseClientMsg(data.toString());
      if (!msg) return conn.send({ t: 'err', code: 'bad' });
      hub.handle(conn, msg, t);
    });
    ws.on('pong', () => alive.set(ws, true));
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      hub.disconnect(conn, now());
      if (live.get(user.uid)?.ws === ws) live.delete(user.uid);
    });
  }

  const tick = deps.autoTick === false ? null : setInterval(() => hub.tick(now()), 50);
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);

  return {
    server,
    hub,
    close: () =>
      new Promise<void>((resolve) => {
        if (tick) clearInterval(tick);
        clearInterval(beat);
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

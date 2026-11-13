import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { RecordRequest, RewardRequest } from '../hub.js';
import { QUIZ } from '../lyric/quiz.js';
import type { ClientMsg, ServerMsg } from '../protocol.js';
import { createRealtimeServer, sameOrigin, type RealtimeServer } from '../server.js';
import { FANDOM } from '../fandom/world.js';

const LINES = ['하나 둘 셋 넷', '다섯 여섯 일곱 여덟', '아홉 열 열하나 열둘', '가나다 라마바 사아자'];
const USERS: Record<string, { uid: string; name: string }> = { a: { uid: 'ua', name: '에이' }, b: { uid: 'ub', name: '비' } };

let app: RealtimeServer;
let port = 0;
let clock = 1_000_000;
const paid: RewardRequest[] = [];
const saved: RecordRequest[] = [];
/** 기록 저장소의 동작: ok 는 저장하고 갱신된 기록을 돌려주고, off 는 꺼진 것(null), fail 은 실패한다 */
let recordMode: 'ok' | 'off' | 'fail' = 'ok';
const sockets: WebSocket[] = [];

beforeEach(async () => {
  clock = 1_000_000;
  paid.length = 0;
  saved.length = 0;
  recordMode = 'ok';
  app = createRealtimeServer({
    auth: async (cookie) => USERS[cookie?.replace('u=', '') ?? ''] ?? null,
    rewards: {
      async pay(req) {
        paid.push(req);
        return { granted: req.diamonds, capped: false };
      },
    },
    records: {
      async save(req) {
        if (recordMode === 'fail') throw new Error('기록 서버 오류');
        if (recordMode === 'off') return null;
        saved.push(req);
        return { record: { games: saved.length, multiGames: saved.length, wins: 0, totalCorrect: req.correct, bestScore: req.score, bestCorrect: req.correct, recent: [] }, best: { score: false, correct: true } };
      },
    },
    lines: LINES,
    now: () => clock,
    seed: () => 7,
    autoTick: false,
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  port = (app.server.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  sockets.length = 0;
  await app.close();
});

interface Client {
  ws: WebSocket;
  msgs: ServerMsg[];
  send(m: ClientMsg | string): void;
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined;
  all<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[];
  closed: Promise<number>;
}

const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 조건이 참이 될 때까지(최대 ms) 기다린다. 한 번에 많이 몰아 보낸 메시지가 소켓을 지나가는 시간이 기계마다 달라서 고정 대기 대신 쓴다. */
async function until(cond: () => unknown, ms = 3000): Promise<void> {
  for (let waited = 0; waited < ms && !cond(); waited += 20) await settle(20);
}

async function connect(user: string | null, opts: { origin?: string; path?: string } = {}): Promise<Client> {
  const headers: Record<string, string> = { origin: opts.origin ?? `http://127.0.0.1:${port}` };
  if (user) headers.cookie = `u=${user}`;
  const ws = new WebSocket(`ws://127.0.0.1:${port}${opts.path ?? '/rt'}`, { headers });
  sockets.push(ws);
  const msgs: ServerMsg[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString()) as ServerMsg));
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  return {
    ws,
    msgs,
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    last: (t) => [...msgs].reverse().find((m) => m.t === t) as never,
    all: (t) => msgs.filter((m) => m.t === t) as never,
    closed,
  };
}

/** 가사 줄에서 지금 문제의 정답을 찾는다 */
function answerFor(c: Client): string {
  const q = c.last('l.q')!;
  const line = LINES.find((l) => l.startsWith(q.before) && l.endsWith(q.after) && l.length > q.before.length + q.after.length)!;
  return line.slice(q.before.length, line.length - q.after.length);
}

describe('접속 확인', () => {
  it('출처 비교', () => {
    expect(sameOrigin('https://monogame69.net', 'monogame69.net')).toBe(true);
    expect(sameOrigin('http://localhost:5173', 'localhost:5173')).toBe(true);
    expect(sameOrigin('https://evil.example', 'monogame69.net')).toBe(false);
    expect(sameOrigin(undefined, 'monogame69.net')).toBe(false);
    expect(sameOrigin('not a url', 'monogame69.net')).toBe(false);
  });

  it('쿠키가 없거나 모르는 사람이면 401, 출처가 다르면 403, 경로가 다르면 404', async () => {
    await expect(connect(null)).rejects.toThrow('HTTP 401');
    await expect(connect('zzz')).rejects.toThrow('HTTP 401');
    await expect(connect('a', { origin: 'https://evil.example' })).rejects.toThrow('HTTP 403');
    await expect(connect('a', { path: '/other' })).rejects.toThrow('HTTP 404');
  });

  it('로그인한 사람은 hello 를 받는다. 상태 확인 주소도 있다', async () => {
    const c = await connect('a');
    await settle();
    expect(c.last('hello')).toEqual({ t: 'hello', uid: 'ua', name: '에이' });
    const res = await fetch(`http://127.0.0.1:${port}/rt/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', conns: 1 });
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });

  it('같은 계정의 새 접속이 옛 접속을 대체한다', async () => {
    const first = await connect('a');
    const second = await connect('a');
    expect(await first.closed).toBe(4001);
    await settle();
    expect(second.ws.readyState).toBe(WebSocket.OPEN);
    expect(app.hub.stats.conns).toBe(1);
  });

  it('이상한 메시지는 bad, 너무 몰아 보내면 rate 오류를 받는다', async () => {
    const c = await connect('a');
    c.send('not json');
    c.send({ t: 'join', game: 'nope' } as never);
    await settle();
    expect(c.all('err').map((e) => e.code)).toEqual(['bad', 'bad']);
    for (let i = 0; i < 200; i++) c.send({ t: 'leave' });
    await settle(120);
    expect(c.all('err').some((e) => e.code === 'rate')).toBe(true);
  });
});

/** 대기실이 닫히고 solvedRounds 문제를 둘 다 맞힌 뒤, 아무도 못 맞힌 문제로 끝나 결과가 나올 때까지 진행한다. */
async function playToEnd(a: Client, b: Client, solvedRounds: number): Promise<void> {
  clock += QUIZ.lobbyMs;
  app.hub.tick(clock);
  await settle();
  for (let r = 0; r < solvedRounds; r++) {
    expect(a.last('l.q')?.round).toBe(r + 1);
    a.send({ t: 'ans', text: '틀린 답' });
    await settle();
    expect(a.last('l.me')).toMatchObject({ ok: false });
    clock += 300;
    a.send({ t: 'ans', text: answerFor(a) });
    clock += 300;
    b.send({ t: 'ans', text: answerFor(b) });
    await settle();
    expect(a.last('l.ok')).toBeDefined();
    app.hub.tick(clock);
    await settle();
    expect(a.last('l.reveal')).toBeDefined();
    clock += QUIZ.revealMs;
    app.hub.tick(clock);
    await settle();
  }
  expect(a.last('l.end')).toBeUndefined();
  expect(a.last('l.q')?.round).toBe(solvedRounds + 1);
  clock += QUIZ.answerMs; // 이번 문제는 아무도 못 맞힌다
  app.hub.tick(clock);
  await settle();
  expect(a.last('l.reveal')).toMatchObject({ last: true });
  clock += QUIZ.revealMs;
  app.hub.tick(clock);
  await settle();
}

describe('가사 빈칸 속도전(소켓)', () => {
  it('두 사람이 들어와 끝까지 치르고 결과와 보상을 받는다', async () => {
    const a = await connect('a');
    const b = await connect('b');
    a.send({ t: 'join', game: 'lyric' });
    b.send({ t: 'join', game: 'lyric' });
    await settle();
    expect(a.last('l.lobby')?.players.map((p) => p.name)).toEqual(['에이', '비']);
    expect(app.hub.stats.rooms).toBe(1);

    // 문제 수에 끝이 없다: 맞히는 동안 이어지다가, 아무도 못 맞힌 문제가 나오면 끝난다
    const solvedRounds = 3;
    await playToEnd(a, b, solvedRounds);
    const end = a.last('l.end')!;
    expect(end.rounds).toBe(solvedRounds + 1);
    expect(end.rewarded).toBe(true);
    expect(end.rows[0]).toMatchObject({ name: '에이', rank: 1, reward: QUIZ.rewards[0] });
    expect(end.rows[1]).toMatchObject({ name: '비', rank: 2, reward: QUIZ.rewards[1] });
    expect(paid.map((p) => [p.uid, p.game, p.diamonds])).toEqual([
      ['ua', 'lyric', QUIZ.rewards[0]],
      ['ub', 'lyric', QUIZ.rewards[1]],
    ]);
    expect(new Set(paid.map((p) => p.ref)).size).toBe(2);
    expect(paid[0].label).toContain('1위');
    expect(a.last('reward')).toEqual({ t: 'reward', diamonds: QUIZ.rewards[0], capped: false });
    // 판 기록: 끝까지 남은 사람마다 한 번씩, 순위·정답 수·이어진 문제 수와 함께 쌓이고 갱신된 내 기록이 그 사람에게 간다
    expect(saved.map((r) => [r.uid, r.game, r.rank, r.players, r.correct, r.rounds, r.multi])).toEqual([
      ['ua', 'lyric', 1, 2, solvedRounds, solvedRounds + 1, true],
      ['ub', 'lyric', 2, 2, solvedRounds, solvedRounds + 1, true],
    ]);
    expect(saved[0].score).toBe(end.rows[0].score);
    expect(new Set(saved.map((r) => r.ref)).size).toBe(2);
    expect(a.last('l.record')).toMatchObject({ t: 'l.record', record: { games: 1, bestScore: saved[0].score }, best: { score: false, correct: true } });
    expect(b.last('l.record')).toBeDefined();
    // 결과 화면에서 다시 하기: 새 방에 들어간다
    a.send({ t: 'join', game: 'lyric' });
    await settle();
    expect(a.msgs.at(-1)).toMatchObject({ t: 'l.lobby' });
    clock += QUIZ.resultMs;
    app.hub.tick(clock);
    expect(app.hub.stats.rooms).toBe(1);
  });

  it('기록 저장이 실패하거나 꺼져 있어도 게임·보상은 그대로 끝나고 기록 메시지만 가지 않는다', async () => {
    for (const mode of ['fail', 'off'] as const) {
      recordMode = mode;
      paid.length = 0;
      clock = 1_000_000;
      const a = await connect('a');
      const b = await connect('b');
      a.send({ t: 'join', game: 'lyric' });
      b.send({ t: 'join', game: 'lyric' });
      await settle();
      await playToEnd(a, b, 1);
      expect(a.last('l.end')).toBeDefined();
      expect(paid).toHaveLength(2);
      expect(a.last('reward')).toBeDefined();
      await settle();
      expect(a.last('l.record')).toBeUndefined();
      expect(saved).toHaveLength(0);
      a.ws.close();
      b.ws.close();
      await Promise.all([a.closed, b.closed]);
      await settle();
    }
  });

  it('혼자 한 판도 기록은 쌓이지만 함께한 판(multi)이 아니다', async () => {
    const a = await connect('a');
    a.send({ t: 'join', game: 'lyric' });
    await settle();
    clock += QUIZ.lobbyMs;
    app.hub.tick(clock);
    await settle();
    clock += QUIZ.answerMs; // 한 문제도 못 맞히고 끝난다
    app.hub.tick(clock);
    await settle();
    clock += QUIZ.revealMs;
    app.hub.tick(clock);
    await until(() => a.last('l.record'));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ uid: 'ua', rank: 1, players: 1, correct: 0, rounds: 1, multi: false });
    expect(paid).toHaveLength(0);
    expect(a.last('l.record')).toBeDefined();
  });

  it('도중에 나가거나 끊으면 방에서 빠진다', async () => {
    const a = await connect('a');
    const b = await connect('b');
    a.send({ t: 'join', game: 'lyric' });
    b.send({ t: 'join', game: 'lyric' });
    await settle();
    a.send({ t: 'join', game: 'lyric' });
    await settle();
    expect(a.last('err')).toEqual({ t: 'err', code: 'busy' });
    b.send({ t: 'leave' });
    await settle();
    expect(b.last('left')).toBeDefined();
    expect(a.last('l.lobby')?.players).toHaveLength(1);
    a.ws.close();
    await a.closed;
    await settle();
    clock += 100;
    app.hub.tick(clock);
    expect(app.hub.stats.rooms).toBe(0);
  });
});

describe('팬덤 모으기(소켓)', () => {
  it('들어가면 시작 정보와 이름표, 스냅샷이 오고 조종이 먹힌다. 시간이 다 되면 결과와 보상이 간다', async () => {
    const a = await connect('a');
    a.send({ t: 'join', game: 'fandom' });
    await settle();
    expect(a.last('f.go')).toMatchObject({ w: FANDOM.w, h: FANDOM.h, runMs: FANDOM.runMs });
    expect(a.last('f.roster')?.list.length).toBe(FANDOM.targetSnakes);
    for (let i = 0; i < 6; i++) {
      clock += FANDOM.stepMs;
      app.hub.tick(clock);
    }
    await settle();
    const snaps = a.all('f.s');
    expect(snaps.length).toBeGreaterThanOrEqual(2);
    const first = snaps[0];
    expect(first.sn.length).toBeGreaterThan(0);
    expect(first.rk[1]).toBe(FANDOM.targetSnakes);

    a.send({ t: 'steer', a: 0, b: 0 });
    await settle();
    const x0 = a.last('f.s')!.me.x;
    for (let i = 0; i < 10; i++) {
      clock += FANDOM.stepMs;
      app.hub.tick(clock);
    }
    await settle();
    expect(Math.abs(a.last('f.s')!.me.x - x0)).toBeGreaterThan(0);

    // 시간이 다 될 때까지 돌린다(방패가 있는 동안·이후 모두 봇과 부딪힐 수 있어 쓰러져도 된다)
    for (let i = 0; i < FANDOM.runMs / FANDOM.stepMs + 5 && !a.last('f.over'); i++) {
      clock += FANDOM.stepMs;
      app.hub.tick(clock);
    }
    await until(() => a.last('f.over'));
    const over = a.last('f.over')!;
    expect(['dead', 'time']).toContain(over.why);
    expect(over.peak).toBeGreaterThanOrEqual(over.fans);
    if (over.reward > 0) {
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({ uid: 'ua', game: 'fandom', diamonds: over.reward });
      expect(a.last('reward')?.diamonds).toBe(over.reward);
    } else {
      expect(paid).toHaveLength(0);
    }
    // 끝난 뒤 다시 들어갈 수 있다
    a.send({ t: 'join', game: 'fandom' });
    await settle();
    expect(a.all('f.go')).toHaveLength(2);
  });

  it('끊으면 도전이 끝나고 세계는 잠시 뒤 정리된다', async () => {
    const a = await connect('a');
    a.send({ t: 'join', game: 'fandom' });
    await settle();
    expect(app.hub.stats.worlds).toBe(1);
    a.ws.close();
    await a.closed;
    await settle();
    clock += 100;
    app.hub.tick(clock);
    clock += 30_000;
    app.hub.tick(clock);
    expect(app.hub.stats.worlds).toBe(0);
  });
});

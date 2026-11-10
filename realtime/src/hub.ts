/*
 * 허브: 접속한 사람들을 게임 방으로 이어 주고 방의 시간을 흘린다.
 * 가사 빈칸 속도전은 대기실이 열린 방에 넣고(없으면 새로 만든다), 팬덤 모으기는 자리가 있는 세계에 넣는다.
 * 보상은 방이 끝날 때 서버가 정해서 `RewardSink`로 보내고, 나간 사람도 받을 수 있다.
 */
import { FANDOM, FandomWorld, type RunResult } from './fandom/world.js';
import { LyricRoom, QUIZ } from './lyric/quiz.js';
import { cleanLines } from './lyric/lines.js';
import type { ClientMsg, EndRow, LiveGame, ServerMsg } from './protocol.js';
import { mulberry32 } from './rng.js';

export interface RewardRequest {
  uid: string;
  game: LiveGame;
  diamonds: number;
  /** 같은 보상을 두 번 보내지 않게 하는 고유 값(방·사람) */
  ref: string;
  /** 우편 제목에 들어갈 말 */
  label: string;
}

export interface RewardSink {
  /** 우편으로 다이아를 보낸다. 실제로 나간 양(하루 한도 적용)을 돌려주고, 보상이 꺼져 있거나 실패하면 null. */
  pay(req: RewardRequest): Promise<{ granted: number; capped: boolean } | null>;
}

export interface Conn {
  uid: string;
  name: string;
  send(msg: ServerMsg): void;
}

export interface HubDeps {
  rewards: RewardSink;
  /** 방을 만들 때 쓰는 난수 씨앗을 만드는 함수(테스트에서 고정) */
  seed?: () => number;
  /** 가사 빈칸 속도전 출제 목록 */
  lines: readonly string[];
  log?: (msg: string) => void;
}

interface Seat {
  conn: Conn;
  game: LiveGame;
  roomId: string;
}

/** 방 없이 한 세계가 비어 있어도 이 시간 동안은 남겨 둔다 */
const WORLD_IDLE_MS = 20_000;

export class Hub {
  private readonly conns = new Map<string, Conn>();
  private readonly seats = new Map<string, Seat>();
  private readonly rooms = new Map<string, LyricRoom>();
  private readonly worlds = new Map<string, FandomWorld>();
  private readonly idleSince = new Map<string, number>();
  private readonly lines: string[];
  /** 팬덤 세계마다 마지막으로 스냅샷을 보낸 걸음 */
  private readonly lastSnap = new Map<string, number>();
  private nextRoom = 1;
  private runSeq = 1;

  constructor(private readonly deps: HubDeps) {
    this.lines = cleanLines(deps.lines);
  }

  get stats(): { conns: number; rooms: number; worlds: number } {
    return { conns: this.conns.size, rooms: this.rooms.size, worlds: this.worlds.size };
  }

  private seed(): number {
    return this.deps.seed ? this.deps.seed() : Math.floor(Math.random() * 2 ** 32);
  }

  private log(msg: string): void {
    this.deps.log?.(msg);
  }

  /* ---------- 접속 ---------- */

  connect(conn: Conn): void {
    this.conns.set(conn.uid, conn);
    conn.send({ t: 'hello', uid: conn.uid, name: conn.name });
  }

  /** 접속이 끊겼다(같은 uid의 새 접속이 이미 이어졌으면 그 접속은 건드리지 않는다). */
  disconnect(conn: Conn, now: number): void {
    if (this.conns.get(conn.uid) !== conn) return;
    this.leaveGame(conn.uid, now);
    this.conns.delete(conn.uid);
  }

  private sendTo(uid: string, msg: ServerMsg): void {
    this.conns.get(uid)?.send(msg);
  }

  /* ---------- 들어오는 메시지 ---------- */

  handle(conn: Conn, msg: ClientMsg, now: number): void {
    if (this.conns.get(conn.uid) !== conn) return;
    switch (msg.t) {
      case 'join':
        this.join(conn, msg.game, now);
        break;
      case 'leave':
        if (this.leaveGame(conn.uid, now)) conn.send({ t: 'left' });
        break;
      case 'ans': {
        const seat = this.seats.get(conn.uid);
        if (seat?.game === 'lyric') this.rooms.get(seat.roomId)?.answer(conn.uid, msg.text, now);
        break;
      }
      case 'steer': {
        const seat = this.seats.get(conn.uid);
        if (seat?.game === 'fandom') this.worlds.get(seat.roomId)?.steer(conn.uid, msg.a, msg.b === 1);
        break;
      }
    }
  }

  private join(conn: Conn, game: LiveGame, now: number): void {
    const cur = this.seats.get(conn.uid);
    if (cur) {
      // 이미 같은 게임 중이면 거절한다. 끝난 가사 방(결과 화면)에서 다시 하는 것은 허락한다.
      const room = cur.game === 'lyric' ? this.rooms.get(cur.roomId) : undefined;
      const finished = cur.game === 'lyric' && (!room || room.phase === 'result' || room.phase === 'closed');
      if (cur.game === game && !finished) return conn.send({ t: 'err', code: 'busy' });
      this.leaveGame(conn.uid, now);
    }
    if (game === 'lyric') this.joinLyric(conn, now);
    else this.joinFandom(conn, now);
  }

  private joinLyric(conn: Conn, now: number): void {
    if (this.lines.length === 0) return conn.send({ t: 'err', code: 'full' });
    let room = [...this.rooms.values()].find((r) => r.joinable);
    if (!room) {
      const id = `l${this.nextRoom++}`;
      const rng = mulberry32(this.seed());
      room = new LyricRoom(id, this.lines, rng, {
        to: (uid, msg) => this.sendTo(uid, msg),
        all: (msg) => this.sendToRoom(id, msg),
        finish: (rows, rewarded) => this.payQuiz(id, rows, rewarded),
      });
      this.rooms.set(id, room);
    }
    this.seats.set(conn.uid, { conn, game: 'lyric', roomId: room.id });
    room.join(conn.uid, conn.name, now);
  }

  private joinFandom(conn: Conn, now: number): void {
    let world = [...this.worlds.values()].find((w) => !w.full);
    if (!world) {
      const id = `f${this.nextRoom++}`;
      world = new FandomWorld(id, mulberry32(this.seed()), {
        over: (uid, result) => this.onFandomOver(id, uid, result),
        roster: () => this.sendRoster(id),
      });
      this.worlds.set(id, world);
    }
    const snake = world.join(conn.uid, conn.name);
    if (!snake) return conn.send({ t: 'err', code: 'full' });
    this.seats.set(conn.uid, { conn, game: 'fandom', roomId: world.id });
    this.idleSince.delete(world.id);
    conn.send({ t: 'f.go', id: snake.id, w: FANDOM.w, h: FANDOM.h, runMs: FANDOM.runMs });
    conn.send({ t: 'f.roster', list: world.roster() });
  }

  /** 게임에서 빠진다. 빠졌으면 true. */
  private leaveGame(uid: string, now: number): boolean {
    const seat = this.seats.get(uid);
    if (!seat) return false;
    this.seats.delete(uid);
    if (seat.game === 'lyric') this.rooms.get(seat.roomId)?.leave(uid, now);
    else this.worlds.get(seat.roomId)?.leave(uid);
    return true;
  }

  private sendToRoom(roomId: string, msg: ServerMsg): void {
    for (const [uid, seat] of this.seats) if (seat.roomId === roomId) this.sendTo(uid, msg);
  }

  private sendRoster(worldId: string): void {
    const world = this.worlds.get(worldId);
    if (!world) return;
    const msg: ServerMsg = { t: 'f.roster', list: world.roster() };
    this.sendToRoom(worldId, msg);
  }

  /* ---------- 보상 ---------- */

  private async pay(req: RewardRequest): Promise<void> {
    if (req.diamonds <= 0) return;
    try {
      const res = await this.deps.rewards.pay(req);
      if (res) this.sendTo(req.uid, { t: 'reward', diamonds: res.granted, capped: res.capped });
    } catch (e) {
      this.log(`보상 실패 ${req.ref}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private payQuiz(roomId: string, rows: EndRow[], rewarded: boolean): void {
    if (!rewarded) return;
    for (const r of rows) {
      const label = r.rank <= QUIZ.rewards.length ? `가사 빈칸 속도전 ${r.rank}위` : '가사 빈칸 속도전 참가';
      void this.pay({ uid: r.uid, game: 'lyric', diamonds: r.reward, ref: `${roomId}:${r.uid}`, label });
    }
  }

  private onFandomOver(worldId: string, uid: string, r: RunResult): void {
    const seat = this.seats.get(uid);
    if (seat?.game === 'fandom' && seat.roomId === worldId) {
      this.seats.delete(uid);
      if (r.why !== 'left') this.sendTo(uid, { t: 'f.over', why: r.why, fans: r.fans, peak: r.peak, kills: r.kills, by: r.by, reward: r.reward });
    }
    void this.pay({ uid, game: 'fandom', diamonds: r.reward, ref: `${worldId}:${uid}:${this.runSeq++}`, label: `팬덤 모으기 ${r.peak}명` });
  }

  /* ---------- 시간 ---------- */

  tick(now: number): void {
    for (const [id, room] of this.rooms) {
      room.advance(now);
      if (room.phase === 'closed') {
        for (const [uid, seat] of this.seats) if (seat.roomId === id) this.seats.delete(uid);
        this.rooms.delete(id);
      }
    }
    for (const [id, world] of this.worlds) {
      if (world.humans === 0) {
        const since = this.idleSince.get(id) ?? now;
        this.idleSince.set(id, since);
        if (now - since >= WORLD_IDLE_MS) {
          this.worlds.delete(id);
          this.idleSince.delete(id);
          this.lastSnap.delete(id);
        }
        continue;
      }
      this.idleSince.delete(id);
      world.advance(now);
      if (world.stepCount - (this.lastSnap.get(id) ?? 0) >= FANDOM.snapEvery) {
        this.lastSnap.set(id, world.stepCount);
        for (const [uid, seat] of this.seats) {
          if (seat.roomId !== id) continue;
          const snap = world.snapshotFor(uid);
          if (snap) this.sendTo(uid, snap);
        }
      }
    }
  }
}

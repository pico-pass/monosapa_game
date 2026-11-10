/*
 * 팬덤 모으기 세계(순수 시뮬레이션): Slither.io 식으로 팬 점을 먹어 행렬(뱀)을 키우고, 남의 행렬 몸에 머리를 박으면 쓰러진다.
 * 서버가 모든 이동·충돌을 계산하고 플레이어는 가고 싶은 방향(steer)만 보낸다. 고정 50ms 걸음이고 무작위는 씨앗 난수뿐이다.
 * 사람이 적어도 판이 비지 않게 봇이 채운다. 한 번의 도전(run)은 목숨 하나, 최대 runMs 까지다.
 */
import type { FandomRosterRow, FandomSnapshot } from '../protocol.js';

export const FANDOM = {
  w: 120,
  h: 120,
  stepMs: 50,
  /** 스냅샷을 몇 걸음마다 보낼지(50ms × 2 = 초당 10번) */
  snapEvery: 2,
  speed: 9,
  boostSpeed: 15,
  /** 방향을 바꾸는 최대 속도(라디안/초) */
  turn: 4.2,
  /** 부스트는 팬을 초당 이만큼 흘리고(뒤에 점으로 떨어진다), 팬이 boostMin 미만이면 못 쓴다 */
  boostCost: 4,
  boostMin: 8,
  /** 몸 마디 간격, 처음 마디 수, 팬 몇 명당 마디 1개, 마디 상한 */
  seg: 1,
  startSegs: 10,
  fansPerSeg: 2,
  maxSegs: 90,
  /** 머리가 남의 몸·머리에 이 거리 안으로 닿으면 충돌 */
  hitR: 1.5,
  pickR: 1.9,
  wallMargin: 0.9,
  ambientDots: 200,
  /** 쓰러진 뱀이 떨어뜨리는 점 하나의 값·최대 개수·사라지는 시간 */
  dropValue: 2,
  dropMax: 80,
  dropLifeMs: 45_000,
  maxDots: 520,
  runMs: 180_000,
  shieldMs: 2_500,
  capacity: 12,
  /** 사람 + 봇의 목표 수와 봇의 최소 수 */
  targetSnakes: 8,
  minBots: 2,
  botRespawnMs: [3_000, 6_000],
  /** 스냅샷에 담는 시야 반폭·반높이(화면은 가로 60칸쯤 보인다) */
  viewHalfW: 32,
  viewHalfH: 46,
  /**
   * 이번 도전에서 가장 많았던 팬 수(peak)에 따른 보상: 팬이 이만큼 이상이면 다이아.
   * 봇 시뮬레이션(`npm run sim:fandom`, 시드 40개)에서 조심스럽게 모으는 봇은 중앙값 126·상위 10% 374, 부주의한 봇은 중앙값 41·상위 10% 118,
   * 아무렇게나 다니거나 가만히 있는 봇은 거의 못 넘는다. 부주의한 쪽이 💎1~2, 조심스러운 쪽이 💎3~5를 받도록 맞췄다.
   */
  rewardTiers: [
    [30, 1],
    [60, 2],
    [100, 3],
    [160, 5],
  ] as readonly (readonly [number, number])[],
} as const;

/** 도전에서 가장 많았던 팬 수에 따른 보상(다이아) */
export function fandomReward(peak: number): number {
  let reward = 0;
  for (const [fans, diamonds] of FANDOM.rewardTiers) if (peak >= fans) reward = diamonds;
  return reward;
}

const BOT_NAMES = ['별빛 팬클럽', '어둠의 응원단', '새벽 4시 팬', '굿나잇 응원단', '마이크 수집가', '야간 직행팬', '응원봉 부대', '한밤의 떼창단', '팬덤 1호', '삼도천 팬', '무대 앞줄', '앵콜 요정'];

interface Pt {
  x: number;
  y: number;
}

interface Dot extends Pt {
  v: number;
  /** 처음부터 있는 점(먹히면 다시 채워진다) */
  amb: boolean;
  /** 이 시각(simNow)에 사라진다. 처음부터 있는 점은 0 */
  until: number;
}

export interface Snake {
  id: number;
  uid: string | null;
  name: string;
  bot: boolean;
  /** 지금 방향과 가고 싶은 방향(라디안) */
  a: number;
  ta: number;
  boost: boolean;
  boostAcc: number;
  /** 머리가 먼저인 마디 목록 */
  pts: Pt[];
  fans: number;
  peak: number;
  kills: number;
  alive: boolean;
  shieldUntil: number;
  /** 사람이 한 판을 마치는 시각 */
  endsAt: number;
  respawnAt: number;
  thinkAt: number;
  wander: number;
}

export interface RunResult {
  why: 'dead' | 'time' | 'left';
  fans: number;
  peak: number;
  kills: number;
  by: string | null;
  reward: number;
}

export interface WorldOut {
  /** 사람의 도전이 끝났다(쓰러짐·시간 종료·나감) */
  over(uid: string, result: RunResult): void;
  /** 이름표가 바뀌었다(사람이 들어오거나 나가고 봇 수가 달라짐) */
  roster(): void;
}

const wrap = (a: number): number => {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  else if (r < -Math.PI) r += Math.PI * 2;
  return r;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class FandomWorld {
  readonly snakes = new Map<number, Snake>();
  readonly dots: Dot[] = [];
  simNow = 0;
  stepCount = 0;
  private acc = 0;
  private lastNow: number | null = null;
  private nextId = 1;
  private ambient = 0;

  constructor(
    readonly id: string,
    private readonly rng: () => number,
    private readonly out: WorldOut,
  ) {
    this.refillAmbient();
  }

  get humans(): number {
    let n = 0;
    for (const s of this.snakes.values()) if (!s.bot) n++;
    return n;
  }

  get full(): boolean {
    return this.humans >= FANDOM.capacity;
  }

  private rand(lo: number, hi: number): number {
    return lo + this.rng() * (hi - lo);
  }

  private humanOf(uid: string): Snake | undefined {
    for (const s of this.snakes.values()) if (s.uid === uid) return s;
    return undefined;
  }

  has(uid: string): boolean {
    return this.humanOf(uid) !== undefined;
  }

  /* ---------- 들어오고 나가기 ---------- */

  join(uid: string, name: string): Snake | null {
    if (this.humanOf(uid)) return this.humanOf(uid) ?? null;
    if (this.full) return null;
    const s = this.makeSnake(uid, name, false);
    s.endsAt = this.simNow + FANDOM.runMs;
    this.snakes.set(s.id, s);
    this.rebalanceBots();
    this.out.roster();
    return s;
  }

  /** 나간다. 도전 중이었으면 지금까지의 기록으로 끝낸다. */
  leave(uid: string): void {
    const s = this.humanOf(uid);
    if (!s) return;
    this.endRun(s, 'left', null);
  }

  steer(uid: string, angle: number, boost: boolean): void {
    const s = this.humanOf(uid);
    if (!s || !s.alive || !Number.isFinite(angle)) return;
    s.ta = wrap(angle);
    s.boost = boost;
  }

  /* ---------- 만들기 ---------- */

  private spawnPoint(): Pt {
    let best: Pt = { x: this.w / 2, y: this.h / 2 };
    let bestD = -1;
    for (let k = 0; k < 8; k++) {
      const p = { x: this.rand(16, this.w - 16), y: this.rand(16, this.h - 16) };
      let d = Infinity;
      for (const s of this.snakes.values()) if (s.alive) d = Math.min(d, Math.hypot(s.pts[0].x - p.x, s.pts[0].y - p.y));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private get w(): number {
    return FANDOM.w;
  }

  private get h(): number {
    return FANDOM.h;
  }

  private placeBody(s: Snake): void {
    const at = this.spawnPoint();
    s.a = s.ta = this.rand(-Math.PI, Math.PI);
    s.pts = Array.from({ length: FANDOM.startSegs }, (_, i) => ({ x: at.x - Math.cos(s.a) * FANDOM.seg * i, y: at.y - Math.sin(s.a) * FANDOM.seg * i }));
    s.fans = 0;
    s.peak = 0;
    s.kills = 0;
    s.boost = false;
    s.boostAcc = 0;
    s.alive = true;
    s.shieldUntil = this.simNow + FANDOM.shieldMs;
  }

  private makeSnake(uid: string | null, name: string, bot: boolean): Snake {
    const s: Snake = {
      id: this.nextId++,
      uid,
      name,
      bot,
      a: 0,
      ta: 0,
      boost: false,
      boostAcc: 0,
      pts: [],
      fans: 0,
      peak: 0,
      kills: 0,
      alive: true,
      shieldUntil: 0,
      endsAt: 0,
      respawnAt: 0,
      thinkAt: 0,
      wander: 0,
    };
    this.placeBody(s);
    return s;
  }

  /** 사람 수에 맞춰 봇 수를 맞춘다: 사람 + 봇이 목표 수가 되게(봇은 최소 minBots) */
  private rebalanceBots(): void {
    const want = clamp(FANDOM.targetSnakes - this.humans, FANDOM.minBots, FANDOM.targetSnakes);
    const bots = [...this.snakes.values()].filter((s) => s.bot);
    let changed = false;
    for (let i = bots.length; i < want; i++) {
      const id = this.nextId;
      const s = this.makeSnake(null, BOT_NAMES[id % BOT_NAMES.length], true);
      this.snakes.set(s.id, s);
      changed = true;
    }
    if (bots.length > want) {
      bots.sort((a, b) => a.fans - b.fans);
      for (const s of bots.slice(0, bots.length - want)) this.snakes.delete(s.id);
      changed = true;
    }
    if (changed) this.out.roster();
  }

  private addDot(x: number, y: number, v: number, amb: boolean, life: number): void {
    if (this.dots.length >= FANDOM.maxDots) return;
    this.dots.push({ x, y, v, amb, until: life > 0 ? this.simNow + life : 0 });
    if (amb) this.ambient++;
  }

  private refillAmbient(): void {
    while (this.ambient < FANDOM.ambientDots && this.dots.length < FANDOM.maxDots) this.addDot(this.rand(2, this.w - 2), this.rand(2, this.h - 2), 1, true, 0);
  }

  /* ---------- 시간 흐르기 ---------- */

  /** 실제 시계(now, ms)만큼 시간을 흘린다. 고정 걸음으로 쪼개고, 한 번에 너무 많이 밀리면 일부를 버린다. */
  advance(now: number): void {
    if (this.lastNow === null) this.lastNow = now;
    this.acc += Math.max(0, now - this.lastNow);
    this.lastNow = now;
    if (this.acc > FANDOM.stepMs * 6) this.acc = FANDOM.stepMs * 6;
    while (this.acc >= FANDOM.stepMs) {
      this.acc -= FANDOM.stepMs;
      this.step();
    }
  }

  private step(): void {
    const dt = FANDOM.stepMs / 1000;
    this.simNow += FANDOM.stepMs;
    this.stepCount++;
    for (const s of [...this.snakes.values()]) {
      if (!s.alive) {
        if (s.bot && this.simNow >= s.respawnAt) this.placeBody(s);
        continue;
      }
      if (s.bot && this.simNow >= s.thinkAt) this.think(s);
      this.move(s, dt);
    }
    this.pickups();
    this.collisions();
    this.timers();
  }

  private move(s: Snake, dt: number): void {
    const maxTurn = FANDOM.turn * dt;
    s.a = wrap(s.a + clamp(wrap(s.ta - s.a), -maxTurn, maxTurn));
    const boosting = s.boost && s.fans >= FANDOM.boostMin;
    const v = (boosting ? FANDOM.boostSpeed : FANDOM.speed) * dt;
    const head = s.pts[0];
    head.x = clamp(head.x + Math.cos(s.a) * v, FANDOM.wallMargin, this.w - FANDOM.wallMargin);
    head.y = clamp(head.y + Math.sin(s.a) * v, FANDOM.wallMargin, this.h - FANDOM.wallMargin);
    if (boosting) {
      s.boostAcc += FANDOM.boostCost * dt;
      while (s.boostAcc >= 1 && s.fans > 0) {
        s.boostAcc -= 1;
        s.fans -= 1;
        const tail = s.pts[s.pts.length - 1];
        this.addDot(tail.x, tail.y, 1, false, 20_000);
      }
    }
    const want = clamp(FANDOM.startSegs + Math.floor(s.fans / FANDOM.fansPerSeg), FANDOM.startSegs, FANDOM.maxSegs);
    while (s.pts.length < want) s.pts.push({ ...s.pts[s.pts.length - 1] });
    while (s.pts.length > want) s.pts.pop();
    for (let i = 1; i < s.pts.length; i++) {
      const p = s.pts[i];
      const q = s.pts[i - 1];
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = Math.hypot(dx, dy);
      if (d > FANDOM.seg) {
        p.x = q.x + (dx / d) * FANDOM.seg;
        p.y = q.y + (dy / d) * FANDOM.seg;
      }
    }
  }

  private pickups(): void {
    const r2 = FANDOM.pickR * FANDOM.pickR;
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const h = s.pts[0];
      for (let k = this.dots.length - 1; k >= 0; k--) {
        const d = this.dots[k];
        const dx = d.x - h.x;
        const dy = d.y - h.y;
        if (dx * dx + dy * dy > r2) continue;
        s.fans += d.v;
        if (s.fans > s.peak) s.peak = s.fans;
        if (d.amb) this.ambient--;
        this.dots[k] = this.dots[this.dots.length - 1];
        this.dots.pop();
      }
    }
  }

  private collisions(): void {
    const dying = new Map<Snake, Snake>();
    const r2 = FANDOM.hitR * FANDOM.hitR;
    const alive = [...this.snakes.values()].filter((s) => s.alive);
    for (const a of alive) {
      if (this.simNow < a.shieldUntil) continue;
      const ah = a.pts[0];
      for (const b of alive) {
        if (b === a) continue;
        const bh = b.pts[0];
        const reach = b.pts.length * FANDOM.seg + FANDOM.hitR;
        if (Math.abs(ah.x - bh.x) > reach || Math.abs(ah.y - bh.y) > reach) continue;
        if (this.simNow >= b.shieldUntil && (ah.x - bh.x) ** 2 + (ah.y - bh.y) ** 2 < r2 && a.fans <= b.fans) {
          dying.set(a, b);
          break;
        }
        // 방패 중인 뱀의 몸은 통과할 수 있다
        if (this.simNow < b.shieldUntil) continue;
        let hit = false;
        for (let i = 1; i < b.pts.length; i++) {
          const dx = ah.x - b.pts[i].x;
          const dy = ah.y - b.pts[i].y;
          if (dx * dx + dy * dy < r2) {
            hit = true;
            break;
          }
        }
        if (hit) {
          dying.set(a, b);
          break;
        }
      }
    }
    for (const [victim, killer] of dying) {
      if (killer.alive && !dying.has(killer)) killer.kills++;
      this.kill(victim, killer);
    }
  }

  /** 쓰러뜨린다: 몸을 따라 팬 점을 떨어뜨리고, 사람이면 도전을 끝내고, 봇이면 잠시 뒤 되살린다. */
  private kill(s: Snake, by: Snake): void {
    s.alive = false;
    const drops = Math.min(FANDOM.dropMax, Math.floor(s.fans / FANDOM.dropValue));
    for (let i = 0; i < drops; i++) {
      const p = s.pts[Math.floor((i * s.pts.length) / drops)];
      this.addDot(p.x + this.rand(-0.4, 0.4), p.y + this.rand(-0.4, 0.4), FANDOM.dropValue, false, FANDOM.dropLifeMs);
    }
    if (s.bot) s.respawnAt = this.simNow + this.rand(FANDOM.botRespawnMs[0], FANDOM.botRespawnMs[1]);
    else this.endRun(s, 'dead', by.name);
  }

  private endRun(s: Snake, why: RunResult['why'], by: string | null): void {
    if (s.uid === null || !this.snakes.has(s.id)) return;
    this.snakes.delete(s.id);
    s.alive = false;
    this.out.over(s.uid, { why, fans: s.fans, peak: s.peak, kills: s.kills, by, reward: fandomReward(s.peak) });
    this.rebalanceBots();
    this.out.roster();
  }

  private timers(): void {
    for (const s of [...this.snakes.values()]) if (!s.bot && s.alive && this.simNow >= s.endsAt) this.endRun(s, 'time', null);
    if (this.stepCount % 20 === 0) {
      for (let k = this.dots.length - 1; k >= 0; k--) {
        const d = this.dots[k];
        if (d.until > 0 && this.simNow >= d.until) {
          this.dots[k] = this.dots[this.dots.length - 1];
          this.dots.pop();
        }
      }
    }
    this.refillAmbient();
  }

  /* ---------- 봇 ---------- */

  /** (x, y)가 막혀 있다: 벽에 가깝거나 다른 뱀의 몸·머리가 가깝다 */
  private blocked(me: Snake, x: number, y: number): boolean {
    if (x < 5 || y < 5 || x > this.w - 5 || y > this.h - 5) return true;
    for (const o of this.snakes.values()) {
      if (o === me || !o.alive) continue;
      for (const p of o.pts) {
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < 2.6 * 2.6) return true;
      }
    }
    return false;
  }

  private think(s: Snake): void {
    s.thinkAt = this.simNow + FANDOM.stepMs * 3;
    const h = s.pts[0];
    const clear = (ang: number): boolean => [3.2, 6.5].every((d) => !this.blocked(s, h.x + Math.cos(ang) * d, h.y + Math.sin(ang) * d));
    if (!clear(s.a)) {
      let turn = s.a + (this.rng() < 0.5 ? 1.2 : -1.2);
      for (const off of [0.5, 1, 1.6, 2.4]) {
        const sign = this.rng() < 0.5 ? 1 : -1;
        if (clear(s.a + sign * off)) {
          turn = s.a + sign * off;
          break;
        }
        if (clear(s.a - sign * off)) {
          turn = s.a - sign * off;
          break;
        }
      }
      s.ta = wrap(turn);
      return;
    }
    let best: Dot | null = null;
    let bestD = 16 * 16;
    for (const d of this.dots) {
      const dd = (d.x - h.x) ** 2 + (d.y - h.y) ** 2 - d.v * d.v * 4;
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    if (best) s.ta = Math.atan2(best.y - h.y, best.x - h.x);
    else {
      s.wander = clamp(s.wander + (this.rng() - 0.5) * 0.6, -1, 1);
      s.ta = wrap(s.a + s.wander);
    }
  }

  /* ---------- 내보내기 ---------- */

  roster(): FandomRosterRow[] {
    return [...this.snakes.values()].map((s) => ({ id: s.id, name: s.name, bot: s.bot }));
  }

  /** uid의 시야에 보이는 것만 담은 스냅샷. 도전 중이 아니면 null. 좌표는 10배 정수. */
  snapshotFor(uid: string): FandomSnapshot | null {
    const me = this.humanOf(uid);
    if (!me || !me.alive) return null;
    const head = me.pts[0];
    const x0 = head.x - FANDOM.viewHalfW;
    const x1 = head.x + FANDOM.viewHalfW;
    const y0 = head.y - FANDOM.viewHalfH;
    const y1 = head.y + FANDOM.viewHalfH;
    const inView = (p: Pt): boolean => p.x >= x0 - 2 && p.x <= x1 + 2 && p.y >= y0 - 2 && p.y <= y1 + 2;
    const sn: number[][] = [];
    const board: Snake[] = [];
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      board.push(s);
      if (!s.pts.some(inView)) continue;
      const row = [s.id, s.fans, this.simNow < s.shieldUntil ? 1 : 0];
      for (const p of s.pts) row.push(Math.round(p.x * 10), Math.round(p.y * 10));
      sn.push(row);
    }
    const dots: number[] = [];
    for (const d of this.dots) if (inView(d)) dots.push(Math.round(d.x * 10), Math.round(d.y * 10), d.v);
    board.sort((a, b) => b.fans - a.fans || a.id - b.id);
    return {
      t: 'f.s',
      left: Math.max(0, me.endsAt - this.simNow),
      me: { x: Math.round(head.x * 10), y: Math.round(head.y * 10), fans: me.fans, boost: me.boost && me.fans >= FANDOM.boostMin ? 1 : 0, shield: this.simNow < me.shieldUntil ? 1 : 0 },
      sn,
      dots,
      lb: board.slice(0, 5).map((s): [number, number] => [s.id, s.fans]),
      rk: [board.indexOf(me) + 1, board.length],
    };
  }
}

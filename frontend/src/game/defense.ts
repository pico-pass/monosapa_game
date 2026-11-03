import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 돌발 사고 막기: 중대형 공연장의 직접 공연. 위에서 무대 쪽으로 내려오는 사고(하울링·낙하 소품·합선·난입 관객·정전)를 아래 스태프 자리의 스태프가 자동으로 막는다.
 * 곡 사이에 예보를 보고 직군을 고용하고, 같은 직군·직급끼리 합쳐서 키우고, 공연 중에는 사고를 직접 눌러 거든다.
 * 규칙은 React·DOM과 무관하고 무작위는 씨앗 난수다. 사고 계획은 씨앗만으로 정해지고 시간은 고정 간격(50ms)으로 잘라서 움직이므로,
 * 같은 씨앗·같은 조작·같은 시각이면 항상 같은 판이 된다. 칸 단위 좌표: x는 0~cols(왼→오), y는 0(위)~fieldH(아래). 수치와 규칙 설명은 balance.ts의 BALANCE.defense.
 */

const B = BALANCE.defense;

export const COLS = B.cols;
export const ROWS = B.rows;
export const SLOTS = COLS * ROWS;
export const LINE_Y = B.lineY;
export const GRID_Y = B.gridY;
export const FIELD_H = GRID_Y + ROWS + 0.15;

const STEP_MS = 50;

export const ROLE_IDS = ['sound', 'stage', 'light', 'safety'] as const;
export type RoleId = (typeof ROLE_IDS)[number];
export const INCIDENT_IDS = ['howl', 'prop', 'spark', 'crasher', 'blackout'] as const;
export type IncidentId = (typeof INCIDENT_IDS)[number];

/** 자리 번호(행 우선, 0이 맨 위 왼쪽)의 중심 좌표 */
export const slotX = (i: number): number => (i % COLS) + 0.5;
export const slotY = (i: number): number => GRID_Y + Math.floor(i / COLS) + 0.5;
/** 좌표가 가리키는 자리 번호, 스태프 자리 밖이면 -1 */
export function slotAt(x: number, y: number): number {
  if (x < 0 || x >= COLS || y < GRID_Y || y >= GRID_Y + ROWS) return -1;
  return Math.floor(y - GRID_Y) * COLS + Math.floor(x);
}

export interface Staff {
  role: RoleId;
  /** 직급 1~maxRank */
  rank: number;
  /** 다음 공격까지 남은 시간(ms) */
  cdMs: number;
}

export interface Incident {
  id: number;
  kind: IncidentId;
  lane: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 느려진 채로 남은 시간(ms) */
  slowMs: number;
  ageMs: number;
  phase: number;
  speed: number;
}

interface Spawn {
  at: number;
  kind: IncidentId;
  lane: number;
  hp: number;
  phase: number;
}

export type DefenseStatus = 'prep' | 'play' | 'over';

export type DefenseEvent =
  | { type: 'spawn'; kind: IncidentId }
  | { type: 'shot'; slot: number; role: RoleId; tx: number; ty: number }
  | { type: 'kill'; kind: IncidentId; x: number; y: number }
  | { type: 'leak'; kind: IncidentId; lane: number }
  | { type: 'hire'; slot: number; role: RoleId }
  | { type: 'merge'; slot: number; role: RoleId; rank: number }
  | { type: 'move' }
  | { type: 'tap'; x: number; y: number }
  | { type: 'blackout'; lane: number }
  | { type: 'waveEnd'; index: number; ratio: number }
  | { type: 'prep'; index: number; stipend: number }
  | { type: 'end' };

export interface DefenseSummary {
  /** 막은 사고 수 */
  blocked: number;
  /** 놓친 사고 수 */
  leaked: number;
  hires: number;
  merges: number;
  /** 가장 높이 키운 직급 */
  topRank: number;
  /** 직접 눌러 준 피해 횟수 */
  taps: number;
  /** 곡별 막은 비율(%) */
  waves: number[];
  seconds: number;
}

/** 사고 종류별로 상대하기 좋은 직군 */
export const COUNTER_ROLE: Record<IncidentId, RoleId> = {
  howl: B.incidents.howl.counter,
  prop: B.incidents.prop.counter,
  spark: B.incidents.spark.counter,
  crasher: B.incidents.crasher.counter,
  blackout: B.incidents.blackout.counter,
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 사고 하나가 무대 앞선까지 내려오는 데 걸리는 시간(ms). 느려지지 않았을 때. */
const travelMs = (kind: IncidentId, wave: number): number => ((LINE_Y - B.spawnY) / (B.incidents[kind].speed * B.speedGrowth[wave])) * 1000;

export class DefenseGame {
  readonly persona: Persona;
  readonly seed: number;
  /** 스태프 자리. 행 우선 rows×cols. */
  slots: (Staff | null)[] = Array.from({ length: SLOTS }, () => null);
  incidents: Incident[] = [];
  status: DefenseStatus = 'prep';
  waveIdx = 0;
  /** 이 곡이 시작된 뒤 지난 시간(ms) */
  waveMs = 0;
  elapsedMs = 0;
  hires = 0;
  merges = 0;
  taps = 0;
  topRank = 0;
  blocked = 0;
  leaked = 0;
  /** 곡별로 막은 무게·놓친 무게·전체 무게 */
  blockedW: number[] = B.waves.map(() => 0);
  leakedW: number[] = B.waves.map(() => 0);
  totalW: number[] = B.waves.map(() => 0);
  /** 칸이 바뀔 때마다 오르는 번호. 화면이 다시 그릴지 가늠하는 데 쓴다. */
  rev = 0;
  /** 화면·효과음용 사건. 읽는 쪽이 비운다. */
  events: DefenseEvent[] = [];
  private money: number = B.startMoney;
  private plan: Spawn[] = [];
  private nextSpawn = 0;
  private nextId = 1;
  private acc = 0;
  private tapCd = 0;
  /** 정전으로 불이 나간 줄(스태프 열) */
  private dark: boolean[] = Array.from({ length: COLS }, () => false);

  constructor(persona: Persona, seed: number) {
    this.persona = persona;
    this.seed = seed >>> 0;
    this.makePlan(0);
  }

  get over(): boolean {
    return this.status === 'over';
  }
  get playing(): boolean {
    return this.status === 'play';
  }
  get cash(): number {
    return Math.floor(this.money);
  }
  /** 다음 고용 비용 */
  get hireCost(): number {
    return B.hireBase + B.hireStep * this.hires;
  }
  /** 이 곡이 끝날 때까지 남은 시간(ms, 0이면 마무리 중) */
  get remainingMs(): number {
    return Math.max(0, B.waves[this.waveIdx].ms - this.waveMs);
  }
  /** 곡 i의 막은 비율(0~1) */
  waveRatio(i: number): number {
    return this.totalW[i] > 0 ? Math.min(1, this.blockedW[i] / this.totalW[i]) : 0;
  }
  /** 열기 점수 0~1000 */
  get score(): number {
    let sum = 0;
    for (let i = 0; i < B.waves.length; i++) sum += B.waveScore * this.waveRatio(i);
    return Math.round(Math.min(1000, sum));
  }
  get cleared(): boolean {
    return this.score >= BALANCE.concert.clearScore;
  }
  get summary(): DefenseSummary {
    return {
      blocked: this.blocked,
      leaked: this.leaked,
      hires: this.hires,
      merges: this.merges,
      topRank: this.topRank,
      taps: this.taps,
      waves: B.waves.map((_, i) => Math.round(this.waveRatio(i) * 100)),
      seconds: Math.round(this.elapsedMs / 1000),
    };
  }

  /** 이번 곡에 나올 사고를 종류별로 센 예보 */
  forecast(): Record<IncidentId, number> {
    const f: Record<IncidentId, number> = { howl: 0, prop: 0, spark: 0, crasher: 0, blackout: 0 };
    for (const s of this.plan) f[s.kind] += 1;
    return f;
  }
  /** 이번 곡에서 아직 막거나 놓치지 않은 사고(나올 것 + 내려오는 중)를 종류별로 센 값 */
  pending(): Record<IncidentId, number> {
    const f: Record<IncidentId, number> = { howl: 0, prop: 0, spark: 0, crasher: 0, blackout: 0 };
    for (let i = this.nextSpawn; i < this.plan.length; i++) f[this.plan[i].kind] += 1;
    for (const inc of this.incidents) f[inc.kind] += 1;
    return f;
  }
  /** 이번 곡에서 나올 사고의 체력 합(예보용 어림값). 종류별로 센다. */
  forecastHp(): Record<IncidentId, number> {
    const f: Record<IncidentId, number> = { howl: 0, prop: 0, spark: 0, crasher: 0, blackout: 0 };
    for (const s of this.plan) f[s.kind] += s.hp;
    return f;
  }

  /** 비어 있는 첫 자리(없으면 -1) */
  freeSlot(): number {
    return this.slots.findIndex((s) => s === null);
  }
  /** 정전으로 불이 나간 줄인지 */
  isDark(col: number): boolean {
    return this.dark[col] === true;
  }
  /** 직군 role 스태프의 직급 합(대충의 전력). 봇이 쓴다. */
  roleRanks(role: RoleId): number {
    let n = 0;
    for (const s of this.slots) if (s && s.role === role) n += B.rankDmg[s.rank];
    return n;
  }
  /** 합칠 수 있는 두 자리를 하나 찾는다(없으면 null). 직급이 낮은 쪽부터. */
  findMerge(): [number, number] | null {
    let best: [number, number] | null = null;
    let bestRank = 99;
    for (let i = 0; i < SLOTS; i++) {
      const a = this.slots[i];
      if (!a || a.rank >= B.maxRank) continue;
      for (let j = i + 1; j < SLOTS; j++) {
        const b = this.slots[j];
        if (b && b.role === a.role && b.rank === a.rank && a.rank < bestRank) {
          best = [i, j];
          bestRank = a.rank;
        }
      }
    }
    return best;
  }

  /** 곡을 시작한다(예보를 보며 준비하던 때에만). */
  start(): boolean {
    if (this.status !== 'prep') return false;
    this.status = 'play';
    this.waveMs = 0;
    this.nextSpawn = 0;
    this.acc = 0;
    this.rev += 1;
    return true;
  }

  /** 직군 role을 고용해 비어 있는 첫 자리에 세운다. 돈이 모자라거나 자리가 없으면 false. */
  hire(role: RoleId): boolean {
    if (this.status === 'over' || !ROLE_IDS.includes(role)) return false;
    const slot = this.freeSlot();
    if (slot < 0 || this.money < this.hireCost) return false;
    this.money -= this.hireCost;
    this.hires += 1;
    this.slots[slot] = { role, rank: 1, cdMs: 0 };
    this.topRank = Math.max(this.topRank, 1);
    this.rev += 1;
    this.emit({ type: 'hire', slot, role });
    return true;
  }

  /**
   * from 자리의 스태프를 to 자리로 가져간다. 같은 직군·같은 직급이면 합쳐지고(to 자리가 한 직급 오름),
   * 아니면 자리만 바뀐다(to가 비어 있으면 옮기고 차 있으면 서로 바꾼다). 아무 일도 안 일어나면 null.
   */
  move(from: number, to: number): 'merge' | 'move' | 'swap' | null {
    if (this.status === 'over' || from === to || from < 0 || to < 0 || from >= SLOTS || to >= SLOTS) return null;
    const a = this.slots[from];
    const b = this.slots[to];
    if (!a) return null;
    if (!b) {
      this.slots[to] = a;
      this.slots[from] = null;
      this.rev += 1;
      this.emit({ type: 'move' });
      return 'move';
    }
    if (a.role === b.role && a.rank === b.rank && a.rank < B.maxRank) {
      b.rank += 1;
      b.cdMs = 0;
      this.slots[from] = null;
      this.merges += 1;
      this.topRank = Math.max(this.topRank, b.rank);
      this.rev += 1;
      this.emit({ type: 'merge', slot: to, role: b.role, rank: b.rank });
      return 'merge';
    }
    this.slots[from] = b;
    this.slots[to] = a;
    this.rev += 1;
    this.emit({ type: 'move' });
    return 'swap';
  }

  /** 좌표(x, y)에 가장 가까운 사고를 직접 눌러 피해를 준다. 공연 중에만, tapCdMs에 한 번. 맞혔으면 true. */
  tap(x: number, y: number): boolean {
    if (this.status !== 'play' || this.tapCd > 0 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    let best: Incident | null = null;
    let bestD = B.tapRadius * B.tapRadius;
    for (const inc of this.incidents) {
      const d = (inc.x - x) ** 2 + (inc.y - y) ** 2;
      if (inc.hp > 0 && d < bestD) {
        bestD = d;
        best = inc;
      }
    }
    if (!best) return false;
    this.tapCd = B.tapCdMs;
    this.taps += 1;
    this.emit({ type: 'tap', x: best.x, y: best.y });
    this.hurt(best, B.tapDmg[this.waveIdx]);
    this.sweep();
    return true;
  }

  /** 실제 경과 시간을 넣는다(공연 중에만 시간이 흐른다). 곡이 끝나면 준비 상태가 되거나(앙코르면) 공연이 끝난다. */
  advance(dtMs: number): void {
    if (this.status !== 'play') return;
    this.acc += Math.max(0, Number.isFinite(dtMs) ? dtMs : 0);
    while (this.acc >= STEP_MS && this.status === 'play') {
      this.acc -= STEP_MS;
      this.step();
    }
  }

  private emit(e: DefenseEvent): void {
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  private step(): void {
    this.waveMs += STEP_MS;
    this.elapsedMs += STEP_MS;
    this.money += B.incomePerSec * (STEP_MS / 1000);
    if (this.tapCd > 0) this.tapCd -= STEP_MS;

    while (this.nextSpawn < this.plan.length && this.plan[this.nextSpawn].at <= this.waveMs) this.spawn(this.plan[this.nextSpawn++]);

    const grow = B.speedGrowth[this.waveIdx];
    for (const inc of this.incidents) {
      inc.ageMs += STEP_MS;
      const slowed = inc.slowMs > 0;
      if (slowed) inc.slowMs -= STEP_MS;
      inc.y += inc.speed * grow * (slowed ? B.roles.light.slowRate : 1) * (STEP_MS / 1000);
      if (inc.kind === 'crasher') inc.x = clamp(inc.lane + 0.5 + Math.sin(inc.phase + (inc.ageMs / 1000) * B.crasherSway.speed * Math.PI) * B.crasherSway.amp, 0.3, COLS - 0.3);
    }
    this.updateDark();

    for (let i = 0; i < SLOTS; i++) {
      const st = this.slots[i];
      if (!st) continue;
      if (st.cdMs > 0) st.cdMs -= this.dark[i % COLS] ? STEP_MS * B.blackoutRate : STEP_MS;
      if (st.cdMs > 0) continue;
      if (this.fire(i, st)) st.cdMs += this.intervalOf(st);
      else st.cdMs = 0;
    }

    // 무대 앞선까지 내려온 사고는 놓친 것이다
    for (let i = this.incidents.length - 1; i >= 0; i--) {
      const inc = this.incidents[i];
      if (inc.y < LINE_Y) continue;
      this.incidents.splice(i, 1);
      this.leak(inc);
    }
    this.sweep();

    const done = this.waveMs >= B.waves[this.waveIdx].ms && this.nextSpawn >= this.plan.length;
    if (done && this.incidents.length === 0) this.endWave();
    else if (done && this.waveMs >= B.waves[this.waveIdx].ms + B.overtimeMs) {
      for (const inc of this.incidents.splice(0)) this.leak(inc);
      this.endWave();
    }
  }

  private intervalOf(st: Staff): number {
    return B.roles[st.role].intervalMs / B.rankRate[st.rank];
  }

  /** 정전(🌑)이 살아 있는 줄을 갱신한다 */
  private updateDark(): void {
    const next = this.dark.map(() => false);
    for (const inc of this.incidents) {
      if (inc.kind === 'blackout' && inc.y > 0.3) next[clamp(Math.floor(inc.x), 0, COLS - 1)] = true;
    }
    for (let c = 0; c < COLS; c++) if (next[c] && !this.dark[c]) this.emit({ type: 'blackout', lane: c });
    this.dark = next;
  }

  /** 스태프 한 명이 사정거리 안에서 가장 많이 내려온 사고를 공격한다. 쏠 대상이 없으면 false. */
  private fire(slot: number, st: Staff): boolean {
    const sx = slotX(slot);
    const sy = slotY(slot);
    const range = B.rankRange[st.rank];
    let target: Incident | null = null;
    for (const inc of this.incidents) {
      if (inc.hp <= 0 || (inc.x - sx) ** 2 + (inc.y - sy) ** 2 > range * range) continue;
      if (!target || inc.y > target.y) target = inc;
    }
    if (!target) return false;
    const def = B.roles[st.role];
    this.emit({ type: 'shot', slot, role: st.role, tx: target.x, ty: target.y });
    const base = def.dmg * B.rankDmg[st.rank];
    this.hurt(target, base * (COUNTER_ROLE[target.kind] === st.role ? B.counterMult : B.offMult));
    if (st.role === 'stage') {
      const stage = B.roles.stage;
      for (const inc of this.incidents) {
        if (inc === target || inc.hp <= 0) continue;
        if ((inc.x - target.x) ** 2 + (inc.y - target.y) ** 2 > stage.splashRadius * stage.splashRadius) continue;
        this.hurt(inc, base * stage.splashRate * (COUNTER_ROLE[inc.kind] === st.role ? B.counterMult : B.offMult));
      }
    } else if (st.role === 'light') {
      target.slowMs = Math.max(target.slowMs, B.roles.light.slowMs);
    } else if (st.role === 'safety' && target.kind !== 'prop') {
      target.y = Math.max(B.spawnY, target.y - B.roles.safety.knock * (1 + 0.25 * (st.rank - 1)));
    }
    return true;
  }

  private hurt(inc: Incident, dmg: number): void {
    inc.hp -= dmg;
  }

  /** 체력이 다한 사고를 치우고 막은 것으로 센다 */
  private sweep(): void {
    for (let i = this.incidents.length - 1; i >= 0; i--) {
      const inc = this.incidents[i];
      if (inc.hp > 0) continue;
      this.incidents.splice(i, 1);
      const def = B.incidents[inc.kind];
      this.money += def.bounty;
      this.blocked += 1;
      this.blockedW[this.waveIdx] += def.weight;
      this.rev += 1;
      this.emit({ type: 'kill', kind: inc.kind, x: inc.x, y: inc.y });
    }
  }

  private leak(inc: Incident): void {
    this.leaked += 1;
    this.leakedW[this.waveIdx] += B.incidents[inc.kind].weight;
    this.rev += 1;
    this.emit({ type: 'leak', kind: inc.kind, lane: inc.lane });
  }

  private spawn(s: Spawn): void {
    const def = B.incidents[s.kind];
    this.incidents.push({
      id: this.nextId++,
      kind: s.kind,
      lane: s.lane,
      x: s.lane + 0.5,
      y: B.spawnY,
      hp: s.hp,
      maxHp: s.hp,
      slowMs: 0,
      ageMs: 0,
      phase: s.phase,
      speed: def.speed,
    });
    this.emit({ type: 'spawn', kind: s.kind });
  }

  private endWave(): void {
    this.emit({ type: 'waveEnd', index: this.waveIdx, ratio: this.waveRatio(this.waveIdx) });
    this.incidents = [];
    this.acc = 0;
    this.updateDark();
    if (this.waveIdx >= B.waves.length - 1) {
      this.status = 'over';
      this.emit({ type: 'end' });
      return;
    }
    this.waveIdx += 1;
    this.waveMs = 0;
    this.status = 'prep';
    const stipend = B.stipend[this.waveIdx];
    this.money += stipend;
    this.makePlan(this.waveIdx);
    this.rev += 1;
    this.emit({ type: 'prep', index: this.waveIdx, stipend });
  }

  /** 곡 wave에 나올 사고 계획을 씨앗으로 정한다(플레이와 무관하게 같은 씨앗이면 같다) */
  private makePlan(wave: number): void {
    const p = B.persona[this.persona];
    const rng = mulberry32(mix(this.seed, 300 + wave));
    const count = p.counts[wave];
    const weights: readonly number[] = p.mix[wave];
    const total = weights.reduce((a, b) => a + b, 0);

    // 최대 잔여법으로 종류별 수를 정하고, 섞는다
    const exact = weights.map((w) => (w / total) * count);
    const per = exact.map((x) => Math.floor(x));
    let left = count - per.reduce((a, b) => a + b, 0);
    const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
    for (const o of order) {
      if (left <= 0) break;
      if (weights[o.i] > 0) {
        per[o.i] += 1;
        left -= 1;
      }
    }
    const kinds: IncidentId[] = [];
    per.forEach((n, i) => {
      for (let k = 0; k < n; k++) kinds.push(INCIDENT_IDS[i]);
    });
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }

    const waveMs = B.waves[wave].ms;
    const out: Spawn[] = [];
    kinds.forEach((kind, i) => {
      const span = Math.max(400, waveMs - 1200 - travelMs(kind, wave));
      const at = Math.round(400 + ((i + rng()) / kinds.length) * span);
      const def = B.incidents[kind];
      const spread = 1 + (rng() * 2 - 1) * B.hpSpread;
      out.push({ at, kind, lane: 0, hp: Math.max(1, Math.round(def.hp * B.hpGrowth[wave] * p.hpMult * spread)), phase: rng() * Math.PI * 2 });
    });
    out.sort((a, b) => a.at - b.at);

    // 겹쳐서 나오는 사고(어둠): 앞 사고 바로 뒤에 다른 줄로 붙여 놓는다
    for (let i = 1; i < out.length; i++) {
      if (rng() < p.cluster) out[i].at = Math.min(waveMs - 800, out[i - 1].at + 120);
    }
    out.sort((a, b) => a.at - b.at);

    // 줄: 같은 줄에 너무 붙어서 나오지 않게 한다(겹치는 사고는 서로 다른 줄)
    for (let i = 0; i < out.length; i++) {
      let lane = Math.floor(rng() * COLS);
      for (let t = 0; t < 8; t++) {
        const clash = out.slice(0, i).some((o) => o.lane === lane && Math.abs(o.at - out[i].at) < 900);
        if (!clash) break;
        lane = Math.floor(rng() * COLS);
      }
      out[i].lane = lane;
    }

    this.plan = out;
    this.nextSpawn = 0;
    this.totalW[wave] = out.reduce((a, s) => a + B.incidents[s.kind].weight, 0);
  }
}

import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 은하 노선 잇기: 유니버스 페스티벌의 직접 공연. 정거장(행성 무대)을 노선으로 이어 관객을 실어 나르는 「Mini Metro」식 게임이다.
 * 규칙은 React·DOM과 무관하고, 정거장 자리·모양·관객은 씨앗 난수로만 정해지며 고정 걸음(stepMs)으로 흐른다.
 * 수치와 규칙 설명은 balance.ts의 BALANCE.galaxy.
 */

const B = BALANCE.galaxy;
export const SHAPE_COUNT = 4;
export const SHAPE_NAMES = ['동그라미', '세모', '네모', '별'] as const;
export const SHAPE_GLYPHS = ['●', '▲', '■', '★'] as const;
/** 노선 색 번호 수(= 한 번에 만들 수 있는 노선의 최대) */
export const LINE_COLORS = 4;

export type GalaxyStatus = 'running' | 'finished';

export interface Station {
  id: number;
  x: number;
  y: number;
  /** 0 ● · 1 ▲ · 2 ■ · 3 ★ */
  shape: number;
  /** 공연 시작부터 이 시각(ms)에 지도에 나타난다 */
  appearAt: number;
  shown: boolean;
  /** 기다리는 관객들이 가고 싶은 모양 (앞이 먼저 온 사람) */
  queue: number[];
  /** 대기가 정원을 넘은 채 지난 시간(ms) */
  over: number;
}

export interface Shuttle {
  id: number;
  /** 지금 있거나 막 떠난 정거장의 노선 안 번호. 다음 정거장은 i0 + dir */
  i0: number;
  dir: 1 | -1;
  /** 이번 구간에서 달린 거리 */
  prog: number;
  /** 정차 중이면 남은 시간(ms) */
  dwell: number;
  /** 타고 있는 관객들이 가고 싶은 모양 */
  load: number[];
}

export interface Line {
  id: number;
  /** 0~LINE_COLORS-1 */
  color: number;
  /** 지나는 정거장 id를 순서대로 */
  stations: number[];
  shuttles: Shuttle[];
}

export type ConnectResult =
  | { ok: true; kind: 'new' | 'extend'; lineId: number }
  | { ok: false; reason: 'over' | 'invalid' | 'no_line' | 'already' | 'not_end' | 'no_slot' };

export type GalaxyEvent =
  | { type: 'station'; id: number }
  | { type: 'deliver'; station: number }
  | { type: 'complaint'; station: number }
  | { type: 'line'; id: number; kind: 'new' | 'extend' | 'remove' }
  | { type: 'shuttle'; line: number }
  | { type: 'grant'; maxLines: number; spare: number }
  | { type: 'wave'; index: number }
  | { type: 'waveEnd'; index: number; ratio: number }
  | { type: 'end' };

export interface GalaxySummary {
  delivered: number;
  spawned: number;
  complaints: number;
  transfers: number;
  stations: number;
  lines: number;
  shuttles: number;
  /** 곡별 점수 비율(%, 100이 상한) */
  waves: number[];
  seconds: number;
}

interface StationPlan {
  x: number;
  y: number;
  shape: number;
  appearAt: number;
}

const MARGIN = 44;
const COLS = 3;
const ROWS = 4;
const JITTER = 22;

/** 정거장 계획. 같은 씨앗이면 항상 같다. 가운데 칸부터 바깥으로 나타나고, 처음 셋은 모양이 서로 다르다. */
export function buildStations(seed: number): StationPlan[] {
  const rng = mulberry32(mix(seed >>> 0, 5000));
  const cw = (B.width - 2 * MARGIN) / COLS;
  const ch = (B.height - 2 * MARGIN) / ROWS;
  const cells: { x: number; y: number; k: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = MARGIN + cw * (c + 0.5);
      const y = MARGIN + ch * (r + 0.5);
      const d = Math.hypot(x - B.width / 2, y - B.height / 2);
      cells.push({ x, y, k: d + rng() * 70 });
    }
  }
  cells.sort((a, b) => a.k - b.k);
  const first = [0, 1, 2];
  for (let i = first.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [first[i], first[j]] = [first[j], first[i]];
  }
  return B.stationAt.map((appearAt, i) => {
    const cell = cells[i];
    const shape = i < 3 ? first[i] : i === B.starAt ? 3 : Math.floor(rng() * 3);
    return {
      x: Math.round(cell.x + (rng() * 2 - 1) * JITTER),
      y: Math.round(cell.y + (rng() * 2 - 1) * JITTER),
      shape,
      appearAt,
    };
  });
}

const dist = (a: Station, b: Station): number => Math.hypot(a.x - b.x, a.y - b.y);

export class GalaxyGame {
  readonly persona: Persona;
  readonly seed: number;
  status: GalaxyStatus = 'running';
  waveIdx = 0;
  waveMs = 0;
  elapsedMs = 0;
  stations: Station[];
  lines: Line[] = [];
  /** 아직 노선에 붙이지 않은 예비 셔틀 */
  spare = 0;
  /** 끝난 곡의 점수 비율 */
  ratios: number[] = [];
  deliveredByWave: number[] = B.waves.map(() => 0);
  complaintsByWave: number[] = B.waves.map(() => 0);
  spawned = 0;
  transfers = 0;
  complaints = 0;
  linesBuilt = 0;
  shuttlesBought = 0;
  /** 바뀔 때마다 오르는 번호 */
  rev = 0;
  /** 화면·효과음용 사건. 읽는 쪽이 비운다. */
  events: GalaxyEvent[] = [];
  private rngs: (() => number)[];
  private nextSpawn: number[];
  private carry = 0;
  private lineSeq = 0;
  private shuttleSeq = 0;
  private adj = new Map<number, number[]>();

  constructor(persona: Persona, seed: number) {
    this.persona = persona;
    this.seed = seed >>> 0;
    const plan = buildStations(this.seed);
    this.stations = plan.map((p, i) => ({ id: i, ...p, shown: false, queue: [], over: 0 }));
    this.rngs = plan.map((_, i) => mulberry32(mix(this.seed, 9000 + i)));
    this.nextSpawn = plan.map((p, i) => p.appearAt + 600 + this.rngs[i]() * B.spawnMs[0] * 0.8);
    this.reveal();
    this.grant();
  }

  get over(): boolean {
    return this.status === 'finished';
  }
  get cfg() {
    return B.persona[this.persona];
  }
  get cap(): number {
    return this.cfg.cap;
  }
  get goal(): number {
    return this.cfg.goals[this.waveIdx];
  }
  get maxLines(): number {
    return B.maxLines[this.waveIdx];
  }
  get remainingMs(): number {
    return Math.max(0, B.waves[this.waveIdx].ms - this.waveMs);
  }
  get delivered(): number {
    return this.deliveredByWave.reduce((a, b) => a + b, 0);
  }
  /** 이번 곡에서 도착시킨 관객에서 불만 감점을 뺀 값 */
  get heat(): number {
    return Math.max(0, this.deliveredByWave[this.waveIdx] - this.complaintsByWave[this.waveIdx] * B.complaintFans);
  }
  get shownStations(): Station[] {
    return this.stations.filter((s) => s.shown);
  }
  /** 곡 점수 비율(0~1). 끝난 곡이면 확정된 값, 진행 중이면 지금까지의 값. */
  waveRatio(i: number): number {
    if (i < this.ratios.length) return this.ratios[i];
    if (i > this.waveIdx || this.status === 'finished') return 0;
    return this.liveRatio();
  }
  private liveRatio(): number {
    return Math.max(0, Math.min(1, this.heat / this.goal));
  }
  get score(): number {
    let sum = 0;
    for (let i = 0; i < B.waves.length; i++) sum += B.waveScore * this.waveRatio(i);
    return Math.round(sum);
  }
  get cleared(): boolean {
    return this.score >= BALANCE.concert.clearScore;
  }
  get summary(): GalaxySummary {
    return {
      delivered: this.delivered,
      spawned: this.spawned,
      complaints: this.complaints,
      transfers: this.transfers,
      stations: this.shownStations.length,
      lines: this.linesBuilt,
      shuttles: this.shuttlesBought,
      waves: B.waves.map((_, i) => Math.round(this.waveRatio(i) * 100)),
      seconds: Math.round(this.elapsedMs / 1000),
    };
  }

  private emit(e: GalaxyEvent): void {
    this.events.push(e);
    this.rev++;
  }

  /* ---------- 노선망 ---------- */

  private rebuildAdj(): void {
    const adj = new Map<number, Set<number>>();
    const link = (a: number, b: number) => {
      if (!adj.has(a)) adj.set(a, new Set());
      adj.get(a)!.add(b);
    };
    for (const l of this.lines) {
      for (let i = 0; i + 1 < l.stations.length; i++) {
        link(l.stations[i], l.stations[i + 1]);
        link(l.stations[i + 1], l.stations[i]);
      }
    }
    this.adj = new Map([...adj].map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));
  }

  /** 노선망에서 from의 관객이 shape 모양 정거장으로 가려면 먼저 가야 할 정거장. 길이 없으면 null. */
  nextHop(from: number, shape: number): number | null {
    const seen = new Set<number>([from]);
    let frontier = (this.adj.get(from) ?? []).map((n) => ({ s: n, first: n }));
    for (const f of frontier) seen.add(f.s);
    while (frontier.length) {
      for (const f of frontier) if (this.stations[f.s].shape === shape) return f.first;
      const next: { s: number; first: number }[] = [];
      for (const f of frontier) {
        for (const n of this.adj.get(f.s) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            next.push({ s: n, first: f.first });
          }
        }
      }
      frontier = next;
    }
    return null;
  }

  /** 노선으로 바로 이어진 이웃 정거장 */
  nextHopNeighbors(id: number): number[] {
    return this.adj.get(id) ?? [];
  }

  /** 지금 이어져 있는 정거장 무리의 수(노선이 닿는 정거장만 센다) */
  get networkParts(): number {
    const ids = [...this.adj.keys()];
    const seen = new Set<number>();
    let parts = 0;
    for (const id of ids) {
      if (seen.has(id)) continue;
      parts++;
      const stack = [id];
      seen.add(id);
      while (stack.length) {
        const cur = stack.pop()!;
        for (const n of this.adj.get(cur) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
    }
    return parts;
  }

  lineOf(id: number): Line | undefined {
    return this.lines.find((l) => l.id === id);
  }

  /* ---------- 조작 ---------- */

  /**
   * 정거장 a에서 b로 노선을 잇는다. a가 어느 노선의 끝이면 그 노선이 b까지 늘어나고(lineId로 노선을 정할 수 있다, 그 노선에 b가 이미 있으면 막힌다),
   * 아니거나 newLine이면 새 노선을 만든다(노선 한도 안에서, 셔틀 한 대가 같이 생긴다).
   */
  connect(a: number, b: number, opts: { newLine?: boolean; lineId?: number } = {}): ConnectResult {
    if (this.status !== 'running') return { ok: false, reason: 'over' };
    const sa = this.stations[a];
    const sb = this.stations[b];
    if (!sa || !sb || !sa.shown || !sb.shown || a === b) return { ok: false, reason: 'invalid' };
    let target: Line | undefined;
    if (opts.lineId !== undefined) {
      target = this.lineOf(opts.lineId);
      if (!target) return { ok: false, reason: 'no_line' };
    } else if (!opts.newLine) {
      // a가 어느 노선의 끝이면 그 노선을 늘린다. 그 노선들에 b가 이미 있으면 새 노선을 만들지 않고 막는다(실수로 노선 자리를 쓰지 않게).
      const ends = this.lines.filter((l) => l.stations[0] === a || l.stations[l.stations.length - 1] === a);
      target = ends.find((l) => !l.stations.includes(b));
      if (!target && ends.length > 0) return { ok: false, reason: 'already' };
    }
    if (target) {
      if (target.stations.includes(b)) return { ok: false, reason: 'already' };
      if (target.stations[target.stations.length - 1] === a) target.stations.push(b);
      else if (target.stations[0] === a) {
        target.stations.unshift(b);
        for (const sh of target.shuttles) sh.i0 += 1;
      } else return { ok: false, reason: 'not_end' };
      this.rebuildAdj();
      this.emit({ type: 'line', id: target.id, kind: 'extend' });
      return { ok: true, kind: 'extend', lineId: target.id };
    }
    if (this.lines.length >= this.maxLines) return { ok: false, reason: 'no_slot' };
    const used = new Set(this.lines.map((l) => l.color));
    let color = 0;
    while (used.has(color)) color++;
    const line: Line = { id: this.lineSeq++, color, stations: [a, b], shuttles: [] };
    this.lines.push(line);
    this.linesBuilt++;
    this.rebuildAdj();
    const first = this.newShuttle();
    line.shuttles.push(first);
    this.dock(line, first);
    this.emit({ type: 'line', id: line.id, kind: 'new' });
    return { ok: true, kind: 'new', lineId: line.id };
  }

  private newShuttle(): Shuttle {
    return { id: this.shuttleSeq++, i0: 0, dir: 1, prog: 0, dwell: 0, load: [] };
  }

  /** 예비 셔틀 한 대를 노선에 붙인다 */
  addShuttle(lineId: number): boolean {
    const line = this.lineOf(lineId);
    if (this.status !== 'running' || !line || this.spare <= 0 || line.shuttles.length >= B.maxShuttles) return false;
    this.spare--;
    const sh = this.newShuttle();
    line.shuttles.push(sh);
    this.dock(line, sh);
    this.shuttlesBought++;
    this.emit({ type: 'shuttle', line: lineId });
    return true;
  }

  /** 노선을 걷어 낸다. 셔틀이 태운 관객은 마지막으로 지난 정거장에 내려 준다. 셔틀은 예비로 돌아오지 않는다. */
  removeLine(lineId: number): boolean {
    const idx = this.lines.findIndex((l) => l.id === lineId);
    if (this.status !== 'running' || idx < 0) return false;
    const line = this.lines[idx];
    for (const sh of line.shuttles) {
      const st = this.stations[line.stations[sh.i0]];
      st.queue.push(...sh.load);
    }
    this.lines.splice(idx, 1);
    this.rebuildAdj();
    this.emit({ type: 'line', id: lineId, kind: 'remove' });
    return true;
  }

  /* ---------- 시간 ---------- */

  private reveal(): void {
    for (const s of this.stations) {
      if (!s.shown && s.appearAt <= this.elapsedMs) {
        s.shown = true;
        if (s.appearAt > 0) this.emit({ type: 'station', id: s.id });
      }
    }
  }

  private grant(): void {
    this.spare += B.spareShuttles[this.waveIdx];
    this.emit({ type: 'grant', maxLines: this.maxLines, spare: this.spare });
  }

  private deliver(st: Station): void {
    this.deliveredByWave[this.waveIdx]++;
    this.emit({ type: 'deliver', station: st.id });
  }

  private spawn(): void {
    const shown = this.shownStations;
    for (const st of shown) {
      if (this.elapsedMs < this.nextSpawn[st.id]) continue;
      const rng = this.rngs[st.id];
      const pool = shown.filter((o) => o.shape !== st.shape);
      if (pool.length > 0) {
        st.queue.push(pool[Math.floor(rng() * pool.length)].shape);
        this.spawned++;
      }
      this.nextSpawn[st.id] = this.elapsedMs + B.spawnMs[this.waveIdx] * this.cfg.spawnMult * (0.65 + rng() * 0.7);
    }
  }

  private crowd(dt: number): void {
    for (const st of this.shownStations) {
      if (st.queue.length > this.cap) {
        st.over += dt;
        if (st.over >= B.overMs) {
          st.queue.length = Math.floor(this.cap / 2);
          st.over = 0;
          this.complaints++;
          this.complaintsByWave[this.waveIdx]++;
          this.emit({ type: 'complaint', station: st.id });
        }
      } else st.over = Math.max(0, st.over - dt * 2);
    }
  }

  private arrive(line: Line, sh: Shuttle): void {
    const idx = sh.i0 + sh.dir;
    const sid = line.stations[idx];
    const st = this.stations[sid];
    let dir = sh.dir;
    if (idx + dir < 0 || idx + dir >= line.stations.length) dir = (-dir) as 1 | -1;
    const nextSid = line.stations[idx + dir];
    const keep: number[] = [];
    for (const dest of sh.load) {
      if (dest === st.shape) this.deliver(st);
      else if (this.nextHop(sid, dest) === nextSid) keep.push(dest);
      else {
        st.queue.push(dest);
        if (this.nextHop(sid, dest) !== null) this.transfers++;
      }
    }
    sh.load = keep;
    this.board(st, sh, nextSid);
    sh.i0 = idx;
    sh.dir = dir;
    sh.prog = 0;
    sh.dwell = B.dwellMs;
  }

  /** 정거장 st에서 기다리는 관객 중 다음 정거장 nextSid 쪽으로 가야 하는 사람을 정원 안에서 태운다 */
  private board(st: Station, sh: Shuttle, nextSid: number): void {
    if (sh.load.length >= B.shuttleCap) return;
    const rest: number[] = [];
    for (const dest of st.queue) {
      if (sh.load.length < B.shuttleCap && this.nextHop(st.id, dest) === nextSid) sh.load.push(dest);
      else rest.push(dest);
    }
    st.queue = rest;
  }

  /** 노선 첫 정거장에 새 셔틀을 세우고 거기서 기다리던 관객을 태운다 */
  private dock(line: Line, sh: Shuttle): void {
    this.board(this.stations[line.stations[0]], sh, line.stations[1]);
    sh.dwell = B.dwellMs;
  }

  private moveShuttles(dt: number): void {
    for (const line of this.lines) {
      for (const sh of line.shuttles) {
        if (sh.dwell > 0) {
          sh.dwell = Math.max(0, sh.dwell - dt);
          continue;
        }
        const a = this.stations[line.stations[sh.i0]];
        const b = this.stations[line.stations[sh.i0 + sh.dir]];
        sh.prog += (B.speed * dt) / 1000;
        if (sh.prog >= dist(a, b)) this.arrive(line, sh);
      }
    }
  }

  /** 셔틀의 지도 위 자리 */
  shuttlePos(line: Line, sh: Shuttle): { x: number; y: number } {
    const a = this.stations[line.stations[sh.i0]];
    const b = this.stations[line.stations[sh.i0 + sh.dir]];
    const len = dist(a, b);
    const t = len > 0 ? Math.min(1, sh.prog / len) : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  private endWave(): void {
    const ratio = this.liveRatio();
    this.ratios.push(ratio);
    this.emit({ type: 'waveEnd', index: this.waveIdx, ratio });
    if (this.waveIdx + 1 >= B.waves.length) {
      this.status = 'finished';
      this.emit({ type: 'end' });
    } else {
      this.waveIdx++;
      this.waveMs = 0;
      this.grant();
      this.emit({ type: 'wave', index: this.waveIdx });
    }
  }

  private step(dt: number): void {
    this.waveMs += dt;
    this.elapsedMs += dt;
    this.reveal();
    this.spawn();
    this.moveShuttles(dt);
    this.crowd(dt);
    this.rev++;
    if (this.waveMs >= B.waves[this.waveIdx].ms) this.endWave();
  }

  /** 실제 경과 시간을 넣는다. 고정 stepMs 걸음으로 쪼개 흘려서 프레임 길이와 상관없이 같은 결과가 나온다. */
  advance(dtMs: number): void {
    this.carry += Math.max(0, dtMs);
    while (this.carry >= B.stepMs && this.status === 'running') {
      this.carry -= B.stepMs;
      this.step(B.stepMs);
    }
    if (this.status !== 'running') this.carry = 0;
  }
}

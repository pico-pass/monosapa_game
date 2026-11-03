import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 음파 튕기기: 중형 공연장의 직접 공연. 마이크에서 나가는 음파 구슬을 벽에 튕겨 1~3층 객석 관객을 깨고, 곡마다 열기 목표를 채우며, 곡 사이에 이펙터를 골라 빌드를 키운다.
 * 규칙은 React·DOM과 무관하고 무작위는 씨앗 난수다. 시간은 고정 간격(1/120초)으로 잘라서 움직이므로 같은 씨앗·같은 조준·같은 시간이면 항상 같은 판이 된다.
 * 칸 단위 좌표를 쓴다: x는 0~cols(왼→오), y는 0~fieldH(위→아래), 객석은 위쪽 rows줄, 마이크는 아래 가운데. 수치와 규칙 설명은 balance.ts의 BALANCE.bounce.
 */

const B = BALANCE.bounce;

export const COLS = B.cols;
export const ROWS = B.rows;
export const CELLS = COLS * ROWS;
export const FIELD_H = B.fieldH;
export const BALL_R = B.ballRadius;
/** 바닥선. 이 아래로 내려간 구슬은 사라진다(메아리가 있으면 한 번 튕겨 오른다). */
export const FLOOR_Y = FIELD_H - 0.1;
export const MIC = { x: COLS / 2, y: FIELD_H - 0.5 };

const STEP_MS = 1000 / 120;
const STEP = STEP_MS / 1000;
const LIFE_STEPS = Math.round(B.ballLifeMs / STEP_MS);

/** 칸 종류: 0 빈 칸, 일반 관객, 폭죽 관객, 방음벽(어둠) */
export const EMPTY = 0;
export const FAN = 1;
export const BOOM = 2;
export const MUTE = 3;

export type EffectId = 'amp' | 'rate' | 'split' | 'pierce' | 'echo';
export const EFFECT_IDS: readonly EffectId[] = ['amp', 'rate', 'split', 'pierce', 'echo'];

export type BounceStatus = 'running' | 'picking' | 'finished';

/** 층(1~3). 1층이 마이크에 가장 가깝고 3층이 맨 뒷줄이다. */
export const tierOfRow = (row: number): number => Math.max(1, Math.min(3, 3 - Math.floor(row / B.tierRows)));

const DEG = Math.PI / 180;
const AIM_MIN = B.aimMinDeg * DEG;
const AIM_MAX = B.aimMaxDeg * DEG;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 마이크에서 (x, y)를 향한 쏘는 각도(라디안, 오른쪽 0 · 위쪽 90°). 허용 범위로 잘라 돌려준다. */
export function aimToward(x: number, y: number): number {
  return clamp(Math.atan2(MIC.y - y, x - MIC.x), AIM_MIN, AIM_MAX);
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 관객에게 한 번 닿을 때 주는 피해 */
  dmg: number;
  /** 앞으로 더 뚫고 지나갈 수 있는 횟수 */
  pierce: number;
  /** 앞으로 더 바닥에서 튕겨 오를 수 있는 횟수 */
  echo: number;
  /** 아직 분열 기회가 남았는지(처음 부딪힐 때 한 번만) */
  split: boolean;
  /** 뚫고 지나가는 중인 칸(그 칸에서 완전히 벗어날 때까지 다시 닿지 않는다) */
  skip: number;
  ageMs: number;
}

interface StepInfo {
  lost: boolean;
  echoed: boolean;
  bounced: boolean;
}
const info: StepInfo = { lost: false, echoed: false, bounced: false };

/** 속도를 ballSpeed로 맞추고, 세로 속도가 너무 느리면 끌어올린다(옆으로만 튕기는 것을 막는다). */
function steady(b: Ball): void {
  const sp = Math.hypot(b.vx, b.vy) || 1;
  let vx = (b.vx / sp) * B.ballSpeed;
  let vy = (b.vy / sp) * B.ballSpeed;
  const minVy = B.ballSpeed * B.minVyRatio;
  if (Math.abs(vy) < minVy) {
    vy = vy > 0 ? minVy : -minVy;
    vx = (vx < 0 ? -1 : 1) * Math.sqrt(B.ballSpeed * B.ballSpeed - vy * vy);
  }
  b.vx = vx;
  b.vy = vy;
}

/**
 * 구슬 하나를 한 걸음(1/120초) 움직인다. 벽·천장·바닥과 kind에 적힌 칸에 부딪히면 튕기고, 칸에 닿으면 onHit(칸 번호)을 부른다.
 * onHit가 true를 돌려주면 구슬이 사라진다(삼켜짐). 결과는 모듈 안의 info 하나를 매번 덮어써서 돌려준다.
 */
function stepBall(b: Ball, kind: Uint8Array, onHit: (cell: number) => boolean): StepInfo {
  info.lost = false;
  info.echoed = false;
  info.bounced = false;
  b.ageMs += STEP_MS;
  b.x += b.vx * STEP;
  b.y += b.vy * STEP;
  let bounced = false;
  if (b.x < BALL_R) {
    b.x = BALL_R;
    b.vx = Math.abs(b.vx);
    bounced = true;
  } else if (b.x > COLS - BALL_R) {
    b.x = COLS - BALL_R;
    b.vx = -Math.abs(b.vx);
    bounced = true;
  }
  if (b.y < BALL_R) {
    b.y = BALL_R;
    b.vy = Math.abs(b.vy);
    bounced = true;
  } else if (b.y > FLOOR_Y) {
    if (b.echo <= 0) {
      info.lost = true;
      return info;
    }
    b.echo -= 1;
    b.y = FLOOR_Y;
    b.vy = -Math.abs(b.vy);
    info.echoed = true;
    bounced = true;
  }

  const r0 = Math.max(0, Math.floor(b.y - BALL_R));
  const r1 = Math.min(ROWS - 1, Math.floor(b.y + BALL_R));
  const c0 = Math.max(0, Math.floor(b.x - BALL_R));
  const c1 = Math.min(COLS - 1, Math.floor(b.x + BALL_R));
  const r2 = BALL_R * BALL_R;
  let best = -1;
  let bestD2 = r2;
  let bcx = 0;
  let bcy = 0;
  let skipStill = false;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * COLS + c;
      if (kind[i] === EMPTY) continue;
      const cx = clamp(b.x, c, c + 1);
      const cy = clamp(b.y, r, r + 1);
      const d2 = (b.x - cx) * (b.x - cx) + (b.y - cy) * (b.y - cy);
      if (d2 >= r2) continue;
      if (i === b.skip) {
        skipStill = true;
        continue;
      }
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
        bcx = cx;
        bcy = cy;
      }
    }
  }
  if (!skipStill) b.skip = -1;
  if (best >= 0) {
    if (onHit(best)) {
      info.lost = true;
      return info;
    }
    if (b.pierce > 0) {
      b.pierce -= 1;
      b.skip = best;
    } else {
      const d = Math.sqrt(bestD2);
      let nx: number;
      let ny: number;
      if (d < 1e-6) {
        // 중심이 칸 안에 들어간 경우: 오던 길로 되돌아 나온다
        const sp = Math.hypot(b.vx, b.vy) || 1;
        nx = -b.vx / sp;
        ny = -b.vy / sp;
      } else {
        nx = (b.x - bcx) / d;
        ny = (b.y - bcy) / d;
      }
      const dot = b.vx * nx + b.vy * ny;
      if (dot < 0) {
        b.vx -= 2 * dot * nx;
        b.vy -= 2 * dot * ny;
      }
      b.x += nx * (BALL_R - d);
      b.y += ny * (BALL_R - d);
      bounced = true;
    }
  }
  if (bounced) steady(b);
  info.bounced = bounced;
  return info;
}

export type BounceEvent =
  | { type: 'hit'; cell: number; killed: boolean }
  | { type: 'break'; cell: number; tier: number; kind: number }
  | { type: 'boom'; cell: number }
  | { type: 'absorb'; cell: number }
  | { type: 'split'; x: number; y: number }
  | { type: 'echo' }
  | { type: 'waveEnd'; index: number; ratio: number }
  | { type: 'pick'; offers: EffectId[] }
  | { type: 'wave'; index: number }
  | { type: 'end' };

export interface BounceSummary {
  /** 깬 관객 수 */
  broken: number;
  /** 그중 맨 뒷줄(3층) 관객 */
  back: number;
  /** 터뜨린 폭죽 관객 */
  booms: number;
  /** 쏜 구슬 수 */
  shots: number;
  /** 한꺼번에 날던 구슬의 최고 수 */
  peakBalls: number;
  /** 곡별 열기 목표 달성률(%, 100이 상한) */
  waves: number[];
  effects: Record<EffectId, number>;
  seconds: number;
}

export class BounceGame {
  readonly persona: Persona;
  readonly seed: number;
  /** 칸별 남은 체력과 종류. 행 우선 ROWS×COLS. */
  readonly hp = new Int16Array(CELLS);
  readonly kind = new Uint8Array(CELLS);
  balls: Ball[] = [];
  status: BounceStatus = 'running';
  waveIdx = 0;
  /** 이 곡이 끝날 때까지 남은 시간(ms) */
  remainingMs: number;
  elapsedMs = 0;
  wavePower: number[] = B.waves.map(() => 0);
  effects: Record<EffectId, number> = { amp: 0, rate: 0, split: 0, pierce: 0, echo: 0 };
  offers: EffectId[] = [];
  /** 쏘는 각도(라디안). 처음엔 똑바로 위. */
  aim = Math.PI / 2;
  /** 칸이 바뀔 때마다 오르는 번호. 화면이 다시 그릴지 가늠하는 데 쓴다. */
  rev = 0;
  broken = 0;
  back = 0;
  booms = 0;
  shots = 0;
  peakBalls = 0;
  /** 화면·효과음용 사건. 읽는 쪽이 비운다. */
  events: BounceEvent[] = [];
  private rng: () => number;
  private acc = 0;
  private fireTimer = 0;
  private refillTimer = 0;
  private born: Ball[] = [];
  private current: Ball | null = null;
  /** 이번 걸음에 구슬이 갈라지기로 정해졌는지(튕긴 뒤의 방향으로 갈라야 해서 걸음이 끝난 뒤에 만든다) */
  private splitPending = false;

  constructor(persona: Persona, seed: number) {
    this.persona = persona;
    this.seed = seed >>> 0;
    this.rng = mulberry32(mix(this.seed, 191));
    this.remainingMs = this.waveMs(0);
    this.fillBoard();
    this.events.length = 0;
  }

  get over(): boolean {
    return this.status === 'finished';
  }
  get picking(): boolean {
    return this.status === 'picking';
  }
  get goal(): number {
    return B.persona[this.persona].goals[this.waveIdx];
  }
  /** 구슬이 관객에게 주는 피해 */
  get damage(): number {
    return 1 + B.effects.ampStep * this.effects.amp;
  }
  get fireIntervalMs(): number {
    return B.fireMs * (1 - B.effects.rateStep) ** this.effects.rate;
  }
  waveMs(i: number): number {
    return B.waves[i].ms;
  }
  /** 곡 i의 달성률(0~1) */
  waveRatio(i: number): number {
    return Math.min(1, this.wavePower[i] / B.persona[this.persona].goals[i]);
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
  get summary(): BounceSummary {
    return {
      broken: this.broken,
      back: this.back,
      booms: this.booms,
      shots: this.shots,
      peakBalls: this.peakBalls,
      waves: B.waves.map((_, i) => Math.round(this.waveRatio(i) * 100)),
      effects: { ...this.effects },
      seconds: Math.round(this.elapsedMs / 1000),
    };
  }

  /** 쏘는 각도를 정한다(허용 범위로 잘린다) */
  setAim(angle: number): void {
    if (Number.isFinite(angle)) this.aim = clamp(angle, AIM_MIN, AIM_MAX);
  }

  /** 실제 경과 시간을 넣는다. 곡이 끝나면 이펙터를 고르는 중이 되거나(앙코르면) 공연이 끝난다. */
  advance(dtMs: number): void {
    if (this.status !== 'running') return;
    const dt = Math.min(Math.max(0, Number.isFinite(dtMs) ? dtMs : 0), this.remainingMs);
    this.elapsedMs += dt;
    this.remainingMs -= dt;
    this.acc += dt;
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      this.step();
    }
    if (this.remainingMs > 0) return;
    this.emit({ type: 'waveEnd', index: this.waveIdx, ratio: this.waveRatio(this.waveIdx) });
    if (this.waveIdx >= B.waves.length - 1) {
      this.status = 'finished';
      this.balls = [];
      this.emit({ type: 'end' });
      return;
    }
    this.offers = this.drawOffers();
    if (this.offers.length === 0) {
      this.startNextWave();
      return;
    }
    this.status = 'picking';
    this.emit({ type: 'pick', offers: [...this.offers] });
  }

  /** 이펙터 후보 중 i번째를 고르고 다음 곡을 시작한다. */
  pick(i: number): boolean {
    if (this.status !== 'picking') return false;
    const id = this.offers[i];
    if (!id) return false;
    this.effects[id] += 1;
    this.offers = [];
    this.startNextWave();
    return true;
  }

  /**
   * 지금 상태에서 구슬 하나를 각도 angle로 쏘면 얻을 응원(피해 × 층 배율)을 미리 계산한다. 판은 바뀌지 않는다.
   * 폭죽·분열은 따지지 않는 어림값이라 조준 도우미(봇)가 쓴다.
   */
  projectShot(angle: number): number {
    const kind = this.kind.slice();
    const hp = this.hp.slice();
    const dmg = this.damage;
    let value = 0;
    const onHit = (cell: number): boolean => {
      const actual = Math.min(dmg, hp[cell]);
      hp[cell] -= actual;
      const wasMute = kind[cell] === MUTE;
      value += actual * B.tierMult[tierOfRow(Math.floor(cell / COLS))] * (wasMute ? B.mute.pointMult : 1);
      if (hp[cell] <= 0) {
        kind[cell] = EMPTY;
        return false;
      }
      return wasMute;
    };
    const ball = this.newBall(clamp(angle, AIM_MIN, AIM_MAX));
    for (let t = 0; t < LIFE_STEPS; t++) if (stepBall(ball, kind, onHit).lost) break;
    return value;
  }

  /**
   * 각도 angle로 쏜 구슬이 지나는 길을 미리 보여 주는 꺾은선(칸 좌표). 마이크에서 시작해 부딪힐 때마다 점을 찍고,
   * maxBounces번 튕기거나 사라질 때까지 따라간다. 판은 바뀌지 않는다.
   */
  aimPath(angle: number, maxBounces = 2): { x: number; y: number }[] {
    const pts = [{ x: MIC.x, y: MIC.y }];
    const ball = this.newBall(clamp(angle, AIM_MIN, AIM_MAX));
    ball.pierce = 0;
    ball.echo = 0;
    let bounces = 0;
    for (let t = 0; t < LIFE_STEPS && bounces < maxBounces; t++) {
      const r = stepBall(ball, this.kind, () => false);
      if (r.lost) {
        pts.push({ x: ball.x, y: Math.min(ball.y, FIELD_H) });
        return pts;
      }
      if (r.bounced) {
        pts.push({ x: ball.x, y: ball.y });
        bounces += 1;
      }
    }
    if (bounces < maxBounces) pts.push({ x: ball.x, y: ball.y });
    return pts;
  }

  private emit(e: BounceEvent): void {
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  private newBall(angle: number): Ball {
    return {
      x: MIC.x,
      y: MIC.y,
      vx: Math.cos(angle) * B.ballSpeed,
      vy: -Math.sin(angle) * B.ballSpeed,
      dmg: this.damage,
      pierce: B.effects.pierceStep * this.effects.pierce,
      echo: B.effects.echoStep * this.effects.echo,
      split: this.effects.split > 0,
      skip: -1,
      ageMs: 0,
    };
  }

  private step(): void {
    this.fireTimer += STEP_MS;
    const interval = this.fireIntervalMs;
    while (this.fireTimer >= interval) {
      this.fireTimer -= interval;
      if (this.balls.length < B.maxBalls) {
        this.balls.push(this.newBall(this.aim));
        this.shots += 1;
      }
    }
    this.refillTimer += STEP_MS;
    const refill = B.refillMs[this.waveIdx];
    while (this.refillTimer >= refill) {
      this.refillTimer -= refill;
      this.refillOne();
    }

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      this.current = b;
      const r = stepBall(b, this.kind, this.onHit);
      if (r.echoed) this.emit({ type: 'echo' });
      if (this.splitPending) {
        this.splitPending = false;
        if (!r.lost) this.born.push(this.splitOff(b));
      }
      if (r.lost || b.ageMs > B.ballLifeMs) this.balls.splice(i, 1);
    }
    this.current = null;
    if (this.born.length > 0) {
      for (const b of this.born) if (this.balls.length < B.maxBalls) this.balls.push(b);
      this.born.length = 0;
    }
    this.peakBalls = Math.max(this.peakBalls, this.balls.length);
  }

  /** 구슬이 칸에 닿았을 때: 피해를 주고, 첫 충돌이면 분열을 굴리고, 삼켜지면 true */
  private onHit = (cell: number): boolean => {
    const b = this.current;
    if (!b) return false;
    const wasMute = this.kind[cell] === MUTE;
    this.damageCell(cell, b.dmg);
    if (b.split) {
      b.split = false;
      if (this.balls.length + this.born.length < B.maxBalls && this.rng() < B.effects.splitChance * this.effects.split) this.splitPending = true;
    }
    // 방음벽은 부서지지 않으면 구슬을 삼킨다
    if (wasMute && this.kind[cell] !== EMPTY) {
      this.emit({ type: 'absorb', cell });
      return true;
    }
    return false;
  };

  /** 튕긴 직후의 구슬 b에서 방향을 조금 비튼 새 구슬 하나를 만든다 */
  private splitOff(b: Ball): Ball {
    const turn = (this.rng() < 0.5 ? -1 : 1) * B.effects.splitAngleDeg * DEG;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const copy: Ball = { ...b, vx: b.vx * cos - b.vy * sin, vy: b.vx * sin + b.vy * cos, split: false, skip: -1 };
    steady(copy);
    this.emit({ type: 'split', x: b.x, y: b.y });
    return copy;
  }

  private damageCell(cell: number, dmg: number): void {
    const k = this.kind[cell];
    if (k === EMPTY) return;
    const row = Math.floor(cell / COLS);
    const tier = tierOfRow(row);
    const actual = Math.min(dmg, this.hp[cell]);
    this.hp[cell] -= actual;
    this.wavePower[this.waveIdx] += actual * B.tierMult[tier] * (k === MUTE ? B.mute.pointMult : 1);
    this.rev += 1;
    const killed = this.hp[cell] <= 0;
    this.emit({ type: 'hit', cell, killed });
    if (!killed) return;
    this.kind[cell] = EMPTY;
    this.broken += 1;
    if (tier === 3) this.back += 1;
    this.emit({ type: 'break', cell, tier, kind: k });
    if (k !== BOOM) return;
    this.booms += 1;
    this.emit({ type: 'boom', cell });
    const boomDmg = Math.max(1, Math.round(B.boom.damageBase * B.hpGrowth[this.waveIdx]));
    const r = Math.floor(cell / COLS);
    const c = cell % COLS;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
        this.damageCell(nr * COLS + nc, boomDmg);
      }
    }
  }

  private startNextWave(): void {
    this.waveIdx += 1;
    this.remainingMs = this.waveMs(this.waveIdx);
    this.status = 'running';
    this.balls = [];
    this.born.length = 0;
    this.fireTimer = 0;
    this.refillTimer = 0;
    this.fillBoard();
    this.emit({ type: 'wave', index: this.waveIdx });
  }

  /** 아직 한도에 안 찬 이펙터 중 offers개를 씨앗으로 고른다 */
  private drawOffers(): EffectId[] {
    const rng = mulberry32(mix(this.seed, 700 + this.waveIdx));
    const pool = EFFECT_IDS.filter((id) => this.effects[id] < B.effectMax[id]);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, B.offers);
  }

  /** (row)줄에 새로 들어올 관객의 종류와 체력을 정한다 */
  private spawnAt(cell: number): void {
    const p = B.persona[this.persona];
    const tier = tierOfRow(Math.floor(cell / COLS));
    const grow = B.hpGrowth[this.waveIdx];
    let k = FAN;
    let base = B.hpBase[tier] * grow * p.hpMult;
    if (this.rng() < p.muteChance[this.waveIdx]) {
      k = MUTE;
      base *= B.mute.hpMult;
    } else if (this.rng() < B.boom.chance) {
      k = BOOM;
      base = B.boom.hpBase * grow;
    }
    const spread = 1 + (this.rng() * 2 - 1) * B.hpSpread;
    this.kind[cell] = k;
    this.hp[cell] = Math.max(1, Math.round(base * spread));
    this.rev += 1;
  }

  /** 곡을 시작할 때 객석을 새로 채운다 */
  private fillBoard(): void {
    this.kind.fill(EMPTY);
    this.hp.fill(0);
    const fill = B.initFill[this.waveIdx];
    for (let i = 0; i < CELLS; i++) if (this.rng() < fill) this.spawnAt(i);
    this.rev += 1;
  }

  private filled(): number {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (this.kind[i] !== EMPTY) n++;
    return n;
  }

  /** 빈 칸 하나에 새 관객이 들어온다(구슬이 그 칸에 걸쳐 있으면 건너뛴다) */
  private refillOne(): void {
    if (this.filled() >= Math.floor(CELLS * B.capFill)) return;
    const empty: number[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (this.kind[i] !== EMPTY) continue;
      const r = Math.floor(i / COLS);
      const c = i % COLS;
      const touching = this.balls.some((b) => {
        const dx = b.x - clamp(b.x, c, c + 1);
        const dy = b.y - clamp(b.y, r, r + 1);
        return dx * dx + dy * dy < (BALL_R + 0.05) * (BALL_R + 0.05);
      });
      if (!touching) empty.push(i);
    }
    if (empty.length === 0) return;
    this.spawnAt(empty[Math.floor(this.rng() * empty.length)]);
  }
}

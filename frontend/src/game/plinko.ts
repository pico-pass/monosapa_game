import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 음표 플링코: 위에서 음표 구슬을 쏘아 핀(박수·조명)에 튕기며 연쇄로 악플 괴수의 체력을 깎는다. 구슬이 핀을 칠 때마다 연쇄 배율이 올라 데미지가 커진다.
 * 괴수는 3마리이고, 괴수를 쓰러뜨릴 때마다 유물을 3택 1한다. 구슬은 한 마리에 정해진 개수뿐이라 다 쓰고도 못 쓰러뜨리면 그 판이 끝난다.
 * 어둠 자아는 데미지가 세지만 야유 핀(연쇄를 끊는다)이 섞인다. 구슬 물리는 고정 1/120초 단계이고 무작위는 씨앗 난수라서, 같은 씨앗·같은 조준이면 항상 같은 판이 된다.
 * 좌표는 x 0~w(왼→오), y 0~h(위→아래), 대포는 위 가운데. 조준 각도는 아래 방향이 0이고 오른쪽이 +. 수치는 BALANCE.plinko.
 */

const P = BALANCE.plinko;

export type PegKind = 'peg' | 'gold' | 'bomb' | 'jeer';
export type RelicId = 'big' | 'dmg' | 'boom' | 'extra' | 'bin';
export const RELIC_IDS: readonly RelicId[] = ['big', 'dmg', 'boom', 'extra', 'bin'];
export type PlinkoStatus = 'running' | 'won' | 'lost';
export type Phase = 'aim' | 'fly' | 'choose' | 'done';

export interface Peg {
  x: number;
  y: number;
  kind: PegKind;
  /** 이번 구슬에 맞았다(구슬이 끝나면 사라진다) */
  lit: boolean;
  gone: boolean;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  /** 이번 구슬이 친 핀 수(연쇄) */
  hits: number;
  /** 첫 타 폭발을 이미 썼다 */
  boomed: boolean;
}

export interface Popup {
  x: number;
  y: number;
  dmg: number;
  at: number;
}

const STEP_MS = 1000 / 120;
const STEP = STEP_MS / 1000;
const CANNON = { x: P.w / 2, y: P.cannonY };

/** 구슬이 핀 `p`와 겹쳤을 때 튕겨 나가게 하고 겹친 것을 돌려준다. */
function bounce(b: Ball, p: Peg, ballR: number): boolean {
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const min = P.pegR + ballR;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2) || 1e-6;
  let nx = dx / d;
  const ny = dy / d;
  // 핀 꼭대기에 얹혀 멈추지 않게, 거의 수직으로 맞으면 옆으로 살짝 비튼다
  if (Math.abs(nx) < 0.05) nx = nx < 0 || (nx === 0 && p.x > P.w / 2) ? -0.05 : 0.05;
  const len = Math.hypot(nx, ny);
  const ux = nx / len;
  const uy = ny / len;
  b.x = p.x + ux * min;
  b.y = p.y + uy * min;
  const vn = b.vx * ux + b.vy * uy;
  if (vn < 0) {
    b.vx -= (1 + P.restitution) * vn * ux;
    b.vy -= (1 + P.restitution) * vn * uy;
  }
  return true;
}

/** 구슬을 한 단계 움직인다. 핀에 닿으면 onHit(핀)을 부른다. 바닥 아래로 나가면 true. */
function stepBall(b: Ball, pegs: readonly Peg[], ballR: number, onHit: (p: Peg) => void): boolean {
  b.vy += P.gravity * STEP;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > P.maxSpeed) {
    b.vx *= P.maxSpeed / sp;
    b.vy *= P.maxSpeed / sp;
  }
  b.x += b.vx * STEP;
  b.y += b.vy * STEP;
  b.ageMs += STEP_MS;
  if (b.x < ballR) {
    b.x = ballR;
    b.vx = Math.abs(b.vx) * P.restitution;
  } else if (b.x > P.w - ballR) {
    b.x = P.w - ballR;
    b.vx = -Math.abs(b.vx) * P.restitution;
  }
  if (b.y < ballR) {
    b.y = ballR;
    b.vy = Math.abs(b.vy) * P.restitution;
  }
  for (const p of pegs) {
    if (p.gone) continue;
    if (bounce(b, p, ballR)) onHit(p);
  }
  return b.y > P.h + ballR;
}

/** 한 괴수 판의 핀 배치: 씨앗과 괴수 번호로만 정한다. */
export function buildPegs(seed: number, stage: number, persona: Persona): Peg[] {
  const rng = mulberry32(mix(seed, 0x706c696e + stage * 131));
  rng();
  const pegs: Peg[] = [];
  const gap = (P.w - 2 * P.margin) / (P.cols - 1);
  for (let r = 0; r < P.rows; r++) {
    const odd = r % 2 === 1;
    const n = odd ? P.cols - 1 : P.cols;
    for (let c = 0; c < n; c++) {
      if (rng() < P.holeP) continue;
      pegs.push({ x: P.margin + c * gap + (odd ? gap / 2 : 0), y: P.top + r * P.rowGap, kind: 'peg', lit: false, gone: false });
    }
  }
  const pick = (kind: PegKind, count: number) => {
    for (let i = 0; i < count && pegs.length > 0; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const p = pegs[Math.floor(rng() * pegs.length)];
        if (p.kind === 'peg') {
          p.kind = kind;
          break;
        }
      }
    }
  };
  pick('gold', P.golds);
  pick('bomb', P.bombs);
  if (persona === 'dark') pick('jeer', Math.round(pegs.length * P.dark.jeerP));
  return pegs;
}

export class PlinkoGame {
  persona: Persona;
  private readonly seed: number;
  private readonly rng: () => number;
  private readonly dmgMult: number;

  timeMs = 0;
  status: PlinkoStatus = 'running';
  phase: Phase = 'aim';
  /** 지금 괴수 번호(0부터), 쓰러뜨린 괴수 수 */
  stage = 0;
  cleared = 0;
  hp: number;
  maxHp: number;
  balls: number;
  ball: Ball | null = null;
  pegs: Peg[];
  relics: Record<RelicId, number> = { big: 0, dmg: 0, boom: 0, extra: 0, bin: 0 };
  /** 괴수를 쓰러뜨린 뒤 고를 유물 3개 */
  choices: RelicId[] | null = null;
  popups: Popup[] = [];
  /** 이번 구슬이 떨어진 칸(화면 표시용). 아직 쏘지 않았으면 null */
  lastBin: 'edge' | 'mid' | 'free' | 'none' | null = null;
  totalDmg = 0;

  private freeLeft: number = P.freeCap;
  private acc = 0;

  constructor(persona: Persona, seed: number, power = 0) {
    this.persona = persona;
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.rng();
    this.dmgMult = (persona === 'dark' ? P.dark.dmg : 1) * (1 + Math.max(0, power));
    this.maxHp = P.hp[0];
    this.hp = this.maxHp;
    this.balls = P.balls;
    this.pegs = buildPegs(seed, 0, persona);
  }

  get ballR(): number {
    return P.ballR * (1 + P.bigBonus * this.relics.big);
  }

  /** 점수 0~1000: 괴수를 쓰러뜨린 만큼 800, 다 쓰러뜨리면 남은 구슬로 덤 200 */
  score(): number {
    const prog = this.status === 'won' ? 0 : Math.max(0, Math.min(1, 1 - this.hp / this.maxHp));
    const base = (800 * (this.cleared + prog)) / P.hp.length;
    const bonus = this.status === 'won' ? 200 * Math.min(1, this.balls / P.bonusBalls) : 0;
    return Math.round(base + bonus);
  }

  private damage(p: Peg, ball: Ball): number {
    if (p.kind === 'jeer') return 0;
    const chain = Math.min(P.chainMax, 1 + P.chainStep * ball.hits);
    const kind = p.kind === 'gold' ? P.goldMult : 1;
    return Math.max(1, Math.round(P.dmg * this.dmgMult * (1 + P.dmgBonus * this.relics.dmg) * chain * kind));
  }

  private deal(dmg: number, x: number, y: number): void {
    if (dmg <= 0) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.totalDmg += dmg;
    this.popups.push({ x, y, dmg, at: this.timeMs });
    if (this.popups.length > 14) this.popups.shift();
  }

  /** 폭발: 반지름 안의 불 안 켜진 핀을 한꺼번에 켠다(연쇄 배율은 올리지 않는다). */
  private explode(x: number, y: number, radius: number, ball: Ball): void {
    for (const q of this.pegs) {
      if (q.gone || q.lit || Math.hypot(q.x - x, q.y - y) > radius) continue;
      q.lit = true;
      this.deal(Math.round(this.damage(q, ball) * P.blastMult), q.x, q.y);
    }
  }

  private onHit(p: Peg): void {
    const ball = this.ball;
    if (!ball || p.lit) return;
    p.lit = true;
    if (p.kind === 'jeer') {
      ball.hits = 0;
      return;
    }
    this.deal(this.damage(p, ball), p.x, p.y);
    ball.hits++;
    if (p.kind === 'bomb') this.explode(p.x, p.y, P.bombR, ball);
    if (this.relics.boom > 0 && !ball.boomed) {
      ball.boomed = true;
      this.explode(p.x, p.y, P.boomR * this.relics.boom, ball);
    }
  }

  /** 대포를 쏜다. 각도는 아래 방향이 0, 오른쪽이 +(라디안). 구슬이 날아가는 중이면 무시한다. */
  fire(angle: number): boolean {
    if (this.phase !== 'aim' || this.balls < 1 || this.status !== 'running') return false;
    const a = Math.max(-P.maxAngle, Math.min(P.maxAngle, Number.isFinite(angle) ? angle : 0));
    this.balls--;
    this.ball = { x: CANNON.x, y: CANNON.y, vx: Math.sin(a) * P.shotSpeed, vy: Math.cos(a) * P.shotSpeed, ageMs: 0, hits: 0, boomed: false };
    this.phase = 'fly';
    this.lastBin = null;
    return true;
  }

  /** 조준선 미리보기: 핀에 처음 닿을 때까지의 점들(핀은 건드리지 않는다) */
  preview(angle: number): { x: number; y: number }[] {
    const a = Math.max(-P.maxAngle, Math.min(P.maxAngle, angle));
    const b: Ball = { x: CANNON.x, y: CANNON.y, vx: Math.sin(a) * P.shotSpeed, vy: Math.cos(a) * P.shotSpeed, ageMs: 0, hits: 0, boomed: false };
    const pts = [{ x: b.x, y: b.y }];
    let touched = false;
    for (let i = 0; i < P.previewSteps && !touched; i++) {
      if (stepBall(b, this.pegs, this.ballR, () => (touched = true))) break;
      if (i % 3 === 2 || touched) pts.push({ x: b.x, y: b.y });
    }
    return pts;
  }

  /** 정해진 단계로 시간을 흘린다. 큰 dt도 단계로 쪼개 같은 결과를 낸다. */
  advance(dtMs: number): void {
    if (this.phase !== 'fly' || !this.ball) return;
    this.acc += Math.max(0, dtMs);
    while (this.acc >= STEP_MS && this.phase === 'fly' && this.ball) {
      this.acc -= STEP_MS;
      this.timeMs += STEP_MS;
      const out = stepBall(this.ball, this.pegs, this.ballR, (p) => this.onHit(p));
      if (out || this.ball.ageMs >= P.ballLifeMs) this.endBall(out ? this.ball.x : null);
    }
  }

  private binOf(x: number): 'edge' | 'mid' | 'free' {
    const wide = this.relics.bin > 0 ? P.binWide : 0;
    const half = P.freeHalf + wide;
    if (Math.abs(x - P.w / 2) <= half) return 'free';
    return x < P.w * 0.2 || x > P.w * 0.8 ? 'edge' : 'mid';
  }

  private endBall(x: number | null): void {
    const ball = this.ball;
    this.ball = null;
    this.acc = 0;
    if (ball && x !== null) {
      const bin = this.binOf(x);
      this.lastBin = bin;
      const mult = this.dmgMult * (this.relics.bin > 0 ? P.binMult : 1);
      if (bin === 'edge') this.deal(Math.round(P.binEdge * mult), x, P.h - 6);
      else if (bin === 'mid') this.deal(Math.round(P.binMid * mult), x, P.h - 6);
      else if (this.freeLeft > 0) {
        this.freeLeft--;
        this.balls++;
      }
    } else {
      this.lastBin = 'none';
    }
    for (const p of this.pegs) if (p.lit) p.gone = true;
    if (this.hp <= 0) {
      this.cleared++;
      if (this.cleared >= P.hp.length) {
        this.status = 'won';
        this.phase = 'done';
        return;
      }
      const pool = [...RELIC_IDS];
      const picks: RelicId[] = [];
      for (let i = 0; i < 3; i++) picks.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]);
      this.choices = picks;
      this.phase = 'choose';
      return;
    }
    if (this.balls < 1) {
      this.status = 'lost';
      this.phase = 'done';
      return;
    }
    this.phase = 'aim';
  }

  /** 유물을 고르고 다음 괴수로 넘어간다. 남은 구슬 일부는 이어진다. */
  choose(index: number): boolean {
    if (this.phase !== 'choose' || !this.choices || index < 0 || index >= this.choices.length) return false;
    this.relics[this.choices[index]]++;
    this.choices = null;
    this.stage = this.cleared;
    this.maxHp = P.hp[this.stage];
    this.hp = this.maxHp;
    this.balls = P.balls + P.extraBalls * this.relics.extra + Math.min(this.balls, P.carryMax);
    this.freeLeft = P.freeCap;
    this.pegs = buildPegs(this.seed, this.stage, this.persona);
    this.popups = [];
    this.phase = 'aim';
    return true;
  }
}

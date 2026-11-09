import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import type { Persona } from './types';

/*
 * 게이트 행진: 팬 군중이 길을 따라 달리며 줄지어 선 게이트를 지나 불어나고, 끝에서 악플 괴수와 맞붙는다.
 * 길 폭 0~100을 구간으로 나눈 줄마다 +·×·−·÷ 문(또는 악플 무리와의 싸움)이 있고, 군중은 자기 폭만큼 걸친 구간마다 몫을 나눠 받아 계산된다.
 * 좌우로만 움직이고(앞으로는 일정한 속도) 군중이 클수록 폭이 넓어져 좁은 문에는 걸치게 된다. 줄은 씨앗으로만 정하므로 같은 씨앗·같은 움직임이면 같은 판이다.
 * 어둠 자아는 −·÷ 문이 많고 ×3 문과 큰 싸움이 나온다. 수치는 BALANCE.gate.
 */

const G = BALANCE.gate;

export type OpKind = 'add' | 'mul' | 'sub' | 'div' | 'fight';
export interface Op {
  kind: OpKind;
  /** add·sub는 더하는 수, mul·div는 곱하는/나누는 수, fight는 악플 수 */
  v: number;
}
export interface Seg {
  a: number;
  b: number;
  op: Op;
}
export interface Row {
  /** 이 줄에 닿는 달린 거리 */
  y: number;
  segs: Seg[];
}

export type GateStatus = 'running' | 'won' | 'lost' | 'dead';

/** 구간 하나가 군중 몫 share(0~1, 몫이 곧 인원 n × share)에 하는 일. 싸움은 몫이 얼마든 악플 수만큼 맞붙는다. */
export function applyOp(op: Op, n: number, share: number): number {
  const part = n * share;
  switch (op.kind) {
    case 'add':
      return part + op.v * share;
    case 'sub':
      return Math.max(0, part - op.v * share);
    case 'mul':
      return part * op.v;
    case 'div':
      return part / op.v;
    case 'fight':
      return Math.max(0, part - op.v);
  }
}

/** 군중 n명이 길 위 x에 있을 때 차지하는 반폭 */
export const crowdHalfWidth = (n: number): number => Math.max(G.crowdMinW, Math.min(G.crowdMaxW, G.crowdBase + G.crowdK * Math.sqrt(Math.max(0, n))));

/** 줄 하나를 군중(중심 cx, 인원 n)이 지난 뒤의 인원. 구간 밖(없는 곳)은 모두 구간 안이라 몫의 합이 1이다. */
export function resolveRow(row: Row, cx: number, n: number): number {
  const w = crowdHalfWidth(n);
  const lo = cx - w;
  const hi = cx + w;
  let out = 0;
  for (const s of row.segs) {
    const share = Math.max(0, Math.min(hi, s.b) - Math.max(lo, s.a)) / (hi - lo);
    if (share <= 0) continue;
    out += applyOp(s.op, n, share);
  }
  return Math.max(0, Math.round(out));
}

function makeRow(i: number, rng: () => number, persona: Persona): Row {
  const dark = persona === 'dark';
  const rand = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const count = rng() < G.threeP ? 3 : 2;
  const cuts: number[] = [0];
  if (count === 2) cuts.push(rand(38, 62));
  else cuts.push(rand(26, 40), rand(60, 74));
  cuts.push(G.road);
  const good = Math.floor(rng() * count);
  const fightRow = i >= G.fightFrom && rng() < G.fightP;
  const segs: Seg[] = [];
  for (let k = 0; k < count; k++) {
    let op: Op;
    if (k === good) {
      // 길이 막히지 않게 줄마다 좋은 문(더하기나 곱하기)이 하나는 있다
      op = rng() < (dark ? G.mulP + 0.1 : G.mulP) ? { kind: 'mul', v: rng() < (dark ? G.mul3P + 0.2 : G.mul3P) ? 3 : 2 } : { kind: 'add', v: Math.round((G.addBase + G.addStep * i) * rand(0.8, 1.3)) };
    } else if (fightRow && rng() < 0.7) {
      op = { kind: 'fight', v: Math.round((G.fightBase + G.fightStep * i) * rand(0.8, 1.2) * (dark ? G.dark.fight : 1)) };
    } else {
      const bad = rng() < (dark ? G.dark.badP : G.badP);
      op = bad ? (rng() < 0.5 ? { kind: 'sub', v: Math.round((G.subBase + G.subStep * i) * rand(0.8, 1.3)) } : { kind: 'div', v: 2 }) : { kind: 'add', v: Math.round((G.addBase + G.addStep * i) * rand(0.4, 0.8)) };
    }
    segs.push({ a: Math.round(cuts[k] * 10) / 10, b: Math.round(cuts[k + 1] * 10) / 10, op });
  }
  return { y: G.firstRow + i * G.rowGap, segs };
}

/** 줄 목록은 씨앗과 자아로만 정한다. */
export function buildRows(seed: number, persona: Persona): Row[] {
  const rng = mulberry32(seed);
  rng();
  return Array.from({ length: G.rows }, (_, i) => makeRow(i, rng, persona));
}

/** 줄마다 가장 좋은 문 하나로만 지나갔을 때(군중이 문 하나에 다 들어갈 때) 끝에 남는 인원: 괴수 체력의 기준 */
export function bestStatic(rows: Row[], start: number): number {
  let n = start;
  for (const row of rows) {
    let best = 0;
    for (const s of row.segs) best = Math.max(best, Math.round(applyOp(s.op, n, 1)));
    n = best;
  }
  return n;
}

export interface Input {
  /** 가고 싶은 길 위치 0~100. null이면 그 자리에 머문다. */
  targetX: number | null;
}

export class GateGame {
  persona: Persona;
  readonly rows: Row[];
  readonly bossHp: number;

  timeMs = 0;
  status: GateStatus = 'running';
  /** 달린 거리, 군중 중심 x, 인원 */
  dist = 0;
  x: number = G.road / 2;
  n: number;
  /** 다음에 지날 줄 번호 */
  next = 0;
  /** 마지막으로 지난 줄의 이전·이후 인원(화면 표시용) */
  lastDelta: { from: number; to: number; row: number } | null = null;

  private acc = 0;

  constructor(persona: Persona, seed: number, power = 0) {
    this.persona = persona;
    this.rows = buildRows(seed, persona);
    this.bossHp = Math.max(G.bossMin, Math.round(bestStatic(this.rows, G.start) * G.bossFrac));
    this.n = Math.max(1, Math.round(G.start * (1 + Math.max(0, power))));
  }

  /** 괴수에게 닿는 거리 */
  get bossDist(): number {
    return G.firstRow + (G.rows - 1) * G.rowGap + G.bossGap;
  }

  /** 괴수와의 인원 비율 */
  get ratio(): number {
    return this.n / this.bossHp;
  }

  /** 점수 0~1000: 인원이 괴수 체력의 2배면 만점, 딱 이기면 500 */
  score(): number {
    if (this.status === 'running' || this.status === 'dead') return 0;
    return Math.round(1000 * Math.min(1, this.ratio / 2));
  }

  /** 정해진 단계로 시간을 흘린다. 큰 dt도 단계로 쪼개 같은 결과를 낸다. */
  advance(dtMs: number, input: Input): void {
    if (this.status !== 'running') return;
    this.acc += Math.max(0, dtMs);
    while (this.acc >= G.stepMs && this.status === 'running') {
      this.acc -= G.stepMs;
      this.step(input);
    }
  }

  private step(input: Input): void {
    const dt = G.stepMs / 1000;
    this.timeMs += G.stepMs;
    this.dist += G.speed * dt;
    // 옆으로 움직이기. 길 끝에 군중이 삐져나가지 않게 한다.
    const w = crowdHalfWidth(this.n);
    if (input.targetX !== null) {
      const d = input.targetX - this.x;
      const stepX = G.latSpeed * dt;
      this.x += Math.abs(d) <= stepX ? d : Math.sign(d) * stepX;
    }
    this.x = Math.max(w, Math.min(G.road - w, this.x));
    while (this.next < this.rows.length && this.dist >= this.rows[this.next].y) {
      const from = this.n;
      this.n = resolveRow(this.rows[this.next], this.x, this.n);
      this.lastDelta = { from, to: this.n, row: this.next };
      this.next++;
      if (this.n < 1) {
        this.n = 0;
        this.status = 'dead';
        return;
      }
    }
    if (this.dist >= this.bossDist) this.status = this.n >= this.bossHp ? 'won' : 'lost';
  }
}

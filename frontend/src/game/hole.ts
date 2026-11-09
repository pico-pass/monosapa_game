import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import type { Persona } from './types';

/*
 * 블랙홀 먹기: 무대 위 구멍을 끌고 다니며 소품을 삼켜 점점 커진다. 구멍보다 작은 것만 삼킬 수 있고, 라이벌 구멍과 서로 잡아먹을 수도 있다.
 * 60초 뒤의 구멍 크기와 라이벌 사이 순위가 점수다. 어둠 자아의 삼도천 구멍은 더 빨리 자라고 라이벌도 더 사납다.
 * 고정 시간 단계로만 움직이고 무작위는 씨앗 난수라서, 같은 씨앗·같은 입력이면 항상 같은 판이 된다. 수치는 BALANCE.hole.
 */

const H = BALANCE.hole;

export type HoleStatus = 'running' | 'done';

export interface Prop {
  id: number;
  x: number;
  y: number;
  tier: number;
  size: number;
}

export interface Hole {
  x: number;
  y: number;
  /** 반지름. 면적(r²)이 늘어난 만큼 자란다. */
  r: number;
  /** 이 시각(ms)까지 잡아먹히지 않는다(되살아난 직후) */
  invUntil: number;
}

interface Rival extends Hole {
  tx: number;
  ty: number;
  thinkMs: number;
}

export interface Input {
  /** -1~1. 길이가 1을 넘으면 정규화한다. */
  x: number;
  y: number;
}

const TIER_TOTAL = H.tiers.reduce((a, t) => a + t.weight, 0);

export class HoleGame {
  persona: Persona;
  private readonly rng: () => number;
  private readonly growth: number;
  private readonly rivalSpeed: number;

  timeMs = 0;
  status: HoleStatus = 'running';
  me: Hole;
  rivals: Rival[] = [];
  props: Prop[] = [];
  /** 삼킨 소품 수 · 라이벌을 삼킨 수 · 내가 잡아먹힌 수 */
  eaten = 0;
  rivalsEaten = 0;
  swallowed = 0;

  private spawnCd = 0;
  private nextId = 1;
  private acc = 0;

  constructor(persona: Persona, seed: number, power = 0) {
    this.persona = persona;
    this.rng = mulberry32(seed);
    this.rng();
    const dark = persona === 'dark';
    this.growth = H.growth * (dark ? H.dark.growth : 1) * (1 + Math.max(0, power));
    this.rivalSpeed = H.rivalSpeed * (dark ? H.dark.rivalSpeed : 1);
    this.me = { x: H.size / 2, y: H.size / 2, r: H.startR, invUntil: 0 };
    const corners: [number, number][] = [
      [H.size * 0.18, H.size * 0.18],
      [H.size * 0.82, H.size * 0.82],
    ];
    for (let i = 0; i < H.rivals; i++) {
      const [x, y] = corners[i % corners.length];
      this.rivals.push({ x, y, r: dark ? H.dark.rivalStartR : H.rivalStartR, invUntil: 0, tx: x, ty: y, thinkMs: 0 });
    }
    for (let i = 0; i < H.props; i++) this.spawnProp();
  }

  private rand(lo: number, hi: number): number {
    return lo + this.rng() * (hi - lo);
  }

  private spawnProp(): void {
    let w = this.rng() * TIER_TOTAL;
    let tier = 0;
    for (let i = 0; i < H.tiers.length; i++) {
      w -= H.tiers[i].weight;
      if (w < 0) {
        tier = i;
        break;
      }
    }
    const size = H.tiers[tier].size;
    this.props.push({ id: this.nextId++, x: this.rand(size + 1, H.size - size - 1), y: this.rand(size + 1, H.size - size - 1), tier, size });
  }

  /** 면적 순위로 본 내 등수(1~3) */
  rank(): number {
    return 1 + this.rivals.filter((r) => r.r > this.me.r).length;
  }

  /** 점수 0~1000: 자란 크기 600 + 순위 400 */
  score(): number {
    const grown = Math.min(1, Math.max(0, (this.me.r - H.startR) / (H.targetR - H.startR)));
    const rank = H.rankFrac[Math.min(H.rankFrac.length - 1, this.rank() - 1)];
    return Math.round(600 * grown + 400 * rank);
  }

  private moveSpeed(r: number): number {
    return H.speed * (H.startR / Math.max(H.startR, r)) ** H.speedFall;
  }

  private eat(h: Hole, big: boolean): void {
    // 삼킬 수 있는 소품: 구멍 중심이 소품 가까이 와 있고 소품이 구멍보다 충분히 작다
    const reach = h.r * H.eatReach;
    const limit = h.r * H.eatRatio;
    const rest: Prop[] = [];
    let gain = 0;
    for (const p of this.props) {
      if (p.size <= limit && Math.hypot(p.x - h.x, p.y - h.y) <= reach) {
        gain += p.size * p.size;
        if (big) this.eaten++;
      } else rest.push(p);
    }
    if (gain > 0) {
      this.props = rest;
      const g = big ? this.growth : H.growth * H.rivalGrowth * (this.persona === 'dark' ? H.dark.rivalGrowth : 1);
      h.r = Math.sqrt(h.r * h.r + gain * g);
    }
  }

  private think(rv: Rival): void {
    // 가장 먹음직한 소품(큰 것·가까운 것)을 고르되, 만만한 구멍은 쫓고 무서운 구멍은 피한다
    const limit = rv.r * H.eatRatio;
    let best: Prop | null = null;
    let bestV = -1;
    for (const p of this.props) {
      if (p.size > limit) continue;
      const v = (p.size * p.size) / (Math.hypot(p.x - rv.x, p.y - rv.y) + 4);
      if (v > bestV) {
        bestV = v;
        best = p;
      }
    }
    rv.tx = best ? best.x : H.size / 2;
    rv.ty = best ? best.y : H.size / 2;
    const dm = Math.hypot(this.me.x - rv.x, this.me.y - rv.y);
    if (this.timeMs >= this.me.invUntil) {
      if (rv.r > this.me.r * H.swallowRatio && dm < H.chaseRange) {
        rv.tx = this.me.x;
        rv.ty = this.me.y;
      } else if (this.me.r > rv.r * H.swallowRatio && dm < H.fleeRange) {
        rv.tx = rv.x + (rv.x - this.me.x);
        rv.ty = rv.y + (rv.y - this.me.y);
      }
    }
  }

  private respawn(h: Hole, minR: number): void {
    h.r = Math.max(minR, Math.sqrt(h.r * h.r * H.lossKeep));
    h.x = this.rand(h.r + 2, H.size - h.r - 2);
    h.y = this.rand(h.r + 2, H.size - h.r - 2);
    h.invUntil = this.timeMs + H.invMs;
  }

  /** 정해진 단계로 시간을 흘린다. 큰 dt도 단계로 쪼개 같은 결과를 낸다. */
  advance(dtMs: number, input: Input): void {
    if (this.status !== 'running') return;
    this.acc += Math.max(0, dtMs);
    while (this.acc >= H.stepMs && this.status === 'running') {
      this.acc -= H.stepMs;
      this.step(input);
    }
  }

  private step(input: Input): void {
    const dt = H.stepMs / 1000;
    this.timeMs += H.stepMs;
    // 내 이동
    const len = Math.hypot(input.x, input.y);
    if (len > 0) {
      const k = Math.min(1, len) / len;
      const sp = this.moveSpeed(this.me.r);
      this.me.x = Math.max(this.me.r, Math.min(H.size - this.me.r, this.me.x + input.x * k * sp * dt));
      this.me.y = Math.max(this.me.r, Math.min(H.size - this.me.r, this.me.y + input.y * k * sp * dt));
    }
    // 라이벌 이동
    for (const rv of this.rivals) {
      rv.thinkMs -= H.stepMs;
      if (rv.thinkMs <= 0) {
        this.think(rv);
        rv.thinkMs = H.rivalThinkMs;
      }
      const dx = rv.tx - rv.x;
      const dy = rv.ty - rv.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.3) {
        const sp = this.moveSpeed(rv.r) * this.rivalSpeed;
        rv.x = Math.max(rv.r, Math.min(H.size - rv.r, rv.x + (dx / d) * sp * dt));
        rv.y = Math.max(rv.r, Math.min(H.size - rv.r, rv.y + (dy / d) * sp * dt));
      }
    }
    // 삼키기
    this.eat(this.me, true);
    for (const rv of this.rivals) this.eat(rv, false);
    for (const rv of this.rivals) {
      const d = Math.hypot(rv.x - this.me.x, rv.y - this.me.y);
      if (this.timeMs >= rv.invUntil && this.timeMs >= this.me.invUntil) {
        if (this.me.r > rv.r * H.swallowRatio && d < this.me.r * H.eatReach) {
          this.me.r = Math.sqrt(this.me.r * this.me.r + rv.r * rv.r * (1 - H.lossKeep) * this.growth);
          this.rivalsEaten++;
          this.respawn(rv, H.rivalStartR);
        } else if (rv.r > this.me.r * H.swallowRatio && d < rv.r * H.eatReach) {
          rv.r = Math.sqrt(rv.r * rv.r + this.me.r * this.me.r * (1 - H.lossKeep));
          this.swallowed++;
          this.respawn(this.me, H.startR);
        }
      }
    }
    // 소품은 계속 새로 쏟아진다
    if (this.props.length < H.props) {
      this.spawnCd -= H.stepMs;
      if (this.spawnCd <= 0) {
        this.spawnProp();
        this.spawnCd += H.respawnMs;
      }
    }
    if (this.timeMs >= H.durationMs) this.status = 'done';
  }
}

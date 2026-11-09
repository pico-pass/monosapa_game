import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import type { Persona } from './types';

/*
 * 악플 베기: 아래에서 튀어 오르는 악플 말풍선을 손가락으로 쓱 그어 베고, 팬 하트는 건드리지 않는다.
 * 이어서 벨수록 콤보가 쌓이고, 놓친 악플이나 벤 하트는 체력을 깎는다. 어둠 자아는 벤 악플이 둘로 쪼개져 날아간다.
 * 고정 시간 단계(stepMs)로만 움직이고 무작위는 씨앗 난수라서, 같은 씨앗·같은 그음이면 항상 같은 판이 된다.
 * 좌표는 x 0~w(왼→오), y 0~h(위→아래). 수치는 balance.ts의 BALANCE.slash.
 */

const S = BALANCE.slash;

export type ItemKind = 'troll' | 'big' | 'heart' | 'shard';
export type SlashStatus = 'running' | 'won' | 'dead';

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 이미 베어졌다(화면에서 조각 연출을 잠깐 보여 주고 지운다) */
  cut: boolean;
  /** 베어진 시각(ms) */
  cutAt: number;
}

const RADIUS: Record<ItemKind, number> = { troll: 5.5, big: 8, heart: 5.5, shard: 3.4 };
const POINTS: Record<ItemKind, number> = { troll: 1, big: 3, heart: 0, shard: 0.5 };

/** 점 (px,py)에서 선분 (x1,y1)-(x2,y2)까지의 거리 */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export class SlashGame {
  persona: Persona;
  private readonly rng: () => number;
  private readonly bladeR: number;

  timeMs = 0;
  status: SlashStatus = 'running';
  hp: number;
  readonly maxHp: number;
  /** 지금 이어진 콤보와 이번 판 최고 콤보 */
  combo = 0;
  bestCombo = 0;
  /** 점수가 되는 포인트(콤보 배율이 붙은 값) */
  pts = 0;
  /** 벤 악플 수(큰 악플·조각 포함), 놓친 악플 수, 벤 하트 수 */
  cuts = 0;
  misses = 0;
  heartsCut = 0;
  items: Item[] = [];

  private lastCutMs = -1e9;
  private spawnCd = 500;
  private nextId = 1;
  private acc = 0;

  constructor(persona: Persona, seed: number, power = 0) {
    this.persona = persona;
    this.rng = mulberry32(seed);
    this.rng();
    this.bladeR = S.bladeR * (1 + Math.min(S.powerCap, Math.max(0, power)));
    this.maxHp = persona === 'dark' ? S.darkHp : S.hp;
    this.hp = this.maxHp;
  }

  private rand(lo: number, hi: number): number {
    return lo + this.rng() * (hi - lo);
  }

  /** 점수 0~1000: 포인트 700 + 최고 콤보 300 */
  score(): number {
    return Math.round(700 * Math.min(1, this.pts / S.ptsTarget) + 300 * Math.min(1, this.bestCombo / S.comboTarget));
  }

  private launch(kind: ItemKind, x: number): void {
    const apex = this.rand(0.5, 0.85) * S.h;
    const vy = -Math.sqrt(2 * S.gravity * apex);
    const toward = (S.w / 2 - x) / (S.w / 2);
    this.items.push({ id: this.nextId++, kind, x, y: S.h + RADIUS[kind], vx: toward * this.rand(6, 20) + this.rand(-6, 6), vy, r: RADIUS[kind], cut: false, cutAt: -1 });
  }

  private spawnWave(): void {
    const dark = this.persona === 'dark';
    const heartP = dark ? S.dark.heartP : S.heartP;
    const n = this.rng() < S.multiP ? (this.rng() < 0.4 ? 3 : 2) : 1;
    const slot = S.w / n;
    for (let i = 0; i < n; i++) {
      const r = this.rng();
      const kind: ItemKind = r < heartP ? 'heart' : r < heartP + S.bigP ? 'big' : 'troll';
      this.launch(kind, slot * i + this.rand(slot * 0.2, slot * 0.8));
    }
  }

  /** 그은 선분(손가락이 이번에 지나간 자리)으로 닿은 말풍선을 벤다. 벤 수를 돌려준다. */
  slash(x1: number, y1: number, x2: number, y2: number): number {
    if (this.status !== 'running') return 0;
    let n = 0;
    for (const it of [...this.items]) {
      if (it.cut) continue;
      if (distToSegment(it.x, it.y, x1, y1, x2, y2) > it.r + this.bladeR) continue;
      it.cut = true;
      it.cutAt = this.timeMs;
      n++;
      if (it.kind === 'heart') {
        this.heartsCut++;
        this.combo = 0;
        this.hurt(S.heartCost);
        continue;
      }
      this.cuts++;
      this.combo = this.timeMs - this.lastCutMs <= S.comboGapMs ? this.combo + 1 : 1;
      this.lastCutMs = this.timeMs;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.pts += POINTS[it.kind] * (1 + Math.floor(this.combo / S.comboStep) * S.comboBonus);
      if (this.persona === 'dark' && (it.kind === 'troll' || it.kind === 'big')) {
        const dir = it.id % 2 === 0 ? 1 : -1;
        for (const s of [-1, 1]) {
          this.items.push({ id: this.nextId++, kind: 'shard', x: it.x, y: it.y, vx: s * dir * 16 + it.vx * 0.3, vy: -Math.abs(it.vy) * 0.35 - 12, r: RADIUS.shard, cut: false, cutAt: -1 });
        }
      }
    }
    // 한 번에 여러 개를 베면 덤 포인트
    if (n >= 2) this.pts += (n - 1) * S.multiBonus;
    return n;
  }

  private hurt(n = 1): void {
    this.hp = Math.max(0, this.hp - n);
    if (this.hp <= 0) this.status = 'dead';
  }

  /** 정해진 단계로 시간을 흘린다. 큰 dt도 단계로 쪼개 같은 결과를 낸다. */
  advance(dtMs: number): void {
    if (this.status !== 'running') return;
    this.acc += Math.max(0, dtMs);
    while (this.acc >= S.stepMs && this.status === 'running') {
      this.acc -= S.stepMs;
      this.step();
    }
  }

  private step(): void {
    const dt = S.stepMs / 1000;
    this.timeMs += S.stepMs;
    const t = Math.min(1, this.timeMs / S.durationMs);
    if (this.timeMs < S.durationMs) {
      this.spawnCd -= S.stepMs;
      if (this.spawnCd <= 0) {
        this.spawnWave();
        const gap = S.gapMs[0] + (S.gapMs[1] - S.gapMs[0]) * t;
        this.spawnCd += gap * (this.persona === 'dark' ? S.dark.gapMult : 1) * this.rand(0.85, 1.15);
      }
    }
    const keep: Item[] = [];
    for (const it of this.items) {
      if (it.cut) {
        // 베어진 것은 조각 연출 시간만 남긴다
        if (this.timeMs - it.cutAt < S.fadeMs) {
          it.x += it.vx * dt;
          it.y += it.vy * dt;
          it.vy += S.gravity * dt;
          keep.push(it);
        }
        continue;
      }
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.vy += S.gravity * dt;
      if (it.vy > 0 && it.y > S.h + it.r + 1) {
        if (it.kind === 'troll' || it.kind === 'big') {
          this.misses++;
          this.combo = 0;
          this.hurt();
        }
        continue;
      }
      if (it.x < -it.r * 3 || it.x > S.w + it.r * 3) continue;
      keep.push(it);
    }
    this.items = keep;
    if (this.status === 'running' && this.timeMs >= S.durationMs && !this.items.some((i) => !i.cut)) this.status = 'won';
  }
}

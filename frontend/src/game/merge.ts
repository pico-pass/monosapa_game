import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 응원봉 머지 웨이브: 단콘의 직접 공연. 5×5 무대의 응원봉을 합쳐 곡마다 열기 목표를 채우고, 곡 사이에 이펙터를 골라 빌드를 키운다.
 * 규칙은 React·DOM과 무관하고 무작위는 씨앗 난수라서, 같은 씨앗·같은 입력(탭과 시간)이면 항상 같은 판이 된다.
 * 시간은 곡 길이와 콤보 판정에만 쓰이고 advance(dt)로 넣는다. 수치와 규칙 설명은 balance.ts의 BALANCE.merge.
 */

const M = BALANCE.merge;

export const SIZE = M.size;
const CELLS = SIZE * SIZE;
/** 야유꾼 칸 값(어둠). 0은 빈 칸, 나머지는 단계 × 10 + 색(1~3). */
export const HECKLER = 99;

export const levelOf = (v: number): number => Math.floor(v / 10);
export const colorOf = (v: number): number => v % 10;
const codeOf = (level: number, color: number): number => level * 10 + color;
const isToken = (v: number): boolean => v > 0 && v !== HECKLER;

export type EffectId = 'amp' | 'light' | 'chorus' | 'chain' | 'pair';
export const EFFECT_IDS: readonly EffectId[] = ['amp', 'light', 'chorus', 'chain', 'pair'];

export type MergeStatus = 'running' | 'picking' | 'finished';

const neighbors = (i: number): number[] => {
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  const out: number[] = [];
  if (r > 0) out.push(i - SIZE);
  if (r < SIZE - 1) out.push(i + SIZE);
  if (c > 0) out.push(i - 1);
  if (c < SIZE - 1) out.push(i + 1);
  return out;
};

/** (row, col)의 응원봉과 같은 색·같은 단계로 상하좌우 이어진 칸들(자기 포함). 빈 칸·야유꾼이면 빈 목록. */
export function groupAt(board: ArrayLike<number>, row: number, col: number): number[] {
  if (row < 0 || col < 0 || row >= SIZE || col >= SIZE) return [];
  const start = row * SIZE + col;
  const code = board[start];
  if (!isToken(code)) return [];
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const n of neighbors(cur)) if (!seen.has(n) && board[n] === code) {
      seen.add(n);
      stack.push(n);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** 합칠 수 있는 묶음(minGroup개 이상)에 들어 있는 칸들. 화면에서 "눌러 볼 만한 곳"을 알려 줄 때 쓴다. */
export function mergeableCells(board: ArrayLike<number>, minGroup: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < CELLS; i++) {
    if (out.has(i) || !isToken(board[i])) continue;
    const g = groupAt(board, Math.floor(i / SIZE), i % SIZE);
    if (g.length >= minGroup) for (const c of g) out.add(c);
  }
  return out;
}

export type MergeEvent =
  | { type: 'merge'; cells: number[]; target: number; level: number; size: number; gained: number; combo: number; chain: number }
  | { type: 'heckle'; cells: number[] }
  | { type: 'miss'; cell: number }
  | { type: 'reshuffle' }
  | { type: 'waveEnd'; index: number; ratio: number }
  | { type: 'pick'; offers: EffectId[] }
  | { type: 'wave'; index: number }
  | { type: 'end' };

export type TapResult = { ok: true; gained: number; chain: number; combo: number } | { ok: false; reason: 'over' | 'invalid' | 'small' };

export interface MergeSummary {
  merges: number;
  bestChain: number;
  bestCombo: number;
  /** 만든 가장 높은 단계(별 응원봉을 터뜨렸으면 5) */
  topLevel: number;
  stars: number;
  heckled: number;
  /** 곡별 열기 목표 달성률(%, 100이 상한) */
  waves: number[];
  effects: Record<EffectId, number>;
  seconds: number;
}

export class MergeGame {
  readonly persona: Persona;
  readonly seed: number;
  /** 0 빈 칸, 단계×10+색, HECKLER. 행 우선 SIZE×SIZE. */
  readonly board = new Uint8Array(CELLS);
  status: MergeStatus = 'running';
  waveIdx = 0;
  /** 이 곡이 끝날 때까지 남은 시간(ms) */
  remainingMs: number;
  elapsedMs = 0;
  wavePower: number[] = M.waves.map(() => 0);
  effects: Record<EffectId, number> = { amp: 0, light: 0, chorus: 0, chain: 0, pair: 0 };
  /** 곡이 끝나 이펙터를 고르는 중이면 후보 */
  offers: EffectId[] = [];
  combo = 0;
  bestCombo = 0;
  merges = 0;
  bestChain = 0;
  topLevel = 1;
  stars = 0;
  heckled = 0;
  /** 화면·효과음용 사건. 읽는 쪽이 비운다. */
  events: MergeEvent[] = [];
  private lastMergeAt = -Infinity;
  private rng: () => number;

  constructor(persona: Persona, seed: number) {
    this.persona = persona;
    this.seed = seed >>> 0;
    this.rng = mulberry32(mix(this.seed, 77));
    this.remainingMs = this.waveMs(0);
    for (let i = 0; i < CELLS; i++) this.board[i] = this.spawn();
    this.ensureMove();
    this.events.length = 0;
  }

  /** 끝났는지 본다(타입이 상태 변화를 따라가지 못해서 함수로 읽는다) */
  get over(): boolean {
    return this.status === 'finished';
  }
  get picking(): boolean {
    return this.status === 'picking';
  }
  get minGroup(): number {
    return this.effects.pair > 0 ? M.effects.pairMin : M.minGroup;
  }
  get ampMult(): number {
    return 1 + M.effects.ampStep * this.effects.amp;
  }
  get chainStep(): number {
    return M.chainStep + M.effects.chainBoost * this.effects.chain;
  }
  get chorusChance(): number {
    return M.effects.chorusStep * this.effects.chorus;
  }
  get comboMult(): number {
    return this.combo > 0 ? 1 + M.comboStep * Math.min(this.combo - 1, M.comboMax) : 1;
  }
  get goal(): number {
    return M.persona[this.persona].goals[this.waveIdx];
  }
  waveMs(i: number): number {
    return M.waves[i].ms + this.effects.light * M.effects.lightMs;
  }
  /** 곡 i의 달성률(0~1) */
  waveRatio(i: number): number {
    return Math.min(1, this.wavePower[i] / M.persona[this.persona].goals[i]);
  }
  /** 열기 점수 0~1000 */
  get score(): number {
    let sum = 0;
    for (let i = 0; i < M.waves.length; i++) sum += M.waveScore * this.waveRatio(i);
    return Math.round(Math.min(1000, sum));
  }
  get cleared(): boolean {
    return this.score >= BALANCE.concert.clearScore;
  }
  get summary(): MergeSummary {
    return {
      merges: this.merges,
      bestChain: this.bestChain,
      bestCombo: this.bestCombo,
      topLevel: this.topLevel,
      stars: this.stars,
      heckled: this.heckled,
      waves: M.waves.map((_, i) => Math.round(this.waveRatio(i) * 100)),
      effects: { ...this.effects },
      seconds: Math.round(this.elapsedMs / 1000),
    };
  }

  /** 합칠 수 있는 칸들 */
  get mergeable(): Set<number> {
    return mergeableCells(this.board, this.minGroup);
  }

  /** (row, col)의 응원봉이 속한 묶음을 합친다. 탭한 칸에 한 단계 높은 응원봉이 생긴다. */
  tap(row: number, col: number): TapResult {
    if (this.status !== 'running') return { ok: false, reason: 'over' };
    if (row < 0 || col < 0 || row >= SIZE || col >= SIZE) return { ok: false, reason: 'invalid' };
    const target = row * SIZE + col;
    const v = this.board[target];
    if (!isToken(v)) return { ok: false, reason: 'invalid' };
    let group = groupAt(this.board, row, col);
    if (group.length < this.minGroup) {
      this.combo = 0;
      this.events.push({ type: 'miss', cell: target });
      return { ok: false, reason: 'small' };
    }

    this.combo = this.combo > 0 && this.elapsedMs - this.lastMergeAt <= M.comboMs ? this.combo + 1 : 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.lastMergeAt = this.elapsedMs;

    const color = colorOf(v);
    let level = levelOf(v);
    let chain = 0;
    let total = 0;
    for (;;) {
      // 묶음이 jumpGroup개 이상이면 두 단계를 뛰어오른다(별 응원봉 단계를 넘으면 별로 친다)
      const next = level + (group.length >= M.jumpGroup ? 2 : 1);
      const chainMult = chain === 0 ? 1 : 1 + this.chainStep * chain;
      const comboMult = chain === 0 ? this.comboMult : 1;
      const smallMult = group.length < M.minGroup ? M.effects.pairPower : 1;
      // 판 위의 야유꾼이 많을수록 응원이 묻힌다
      const drain = Math.max(0, 1 - M.heckleDrain * this.countOf(HECKLER));
      let gained = (M.power[Math.min(next, M.maxLevel + 1)] * group.length * chainMult * comboMult * this.ampMult * smallMult * drain) / 3;
      for (const c of group) this.board[c] = 0;
      const hit = this.clearHecklersAround(group);
      gained += hit * M.heckleBonus;
      total += gained;
      this.wavePower[this.waveIdx] += gained;
      this.merges += 1;
      this.topLevel = Math.max(this.topLevel, Math.min(next, M.maxLevel + 1));
      this.events.push({ type: 'merge', cells: group, target, level: Math.min(next, M.maxLevel + 1), size: group.length, gained, combo: this.combo, chain });
      if (next > M.maxLevel) {
        this.stars += 1; // 별 응원봉은 만들어지는 순간 터진다
        break;
      }
      this.board[target] = codeOf(next, color);
      level = next;
      if (chain >= M.chainMax) break;
      group = groupAt(this.board, row, col);
      if (group.length < this.minGroup) break;
      chain += 1;
    }
    this.bestChain = Math.max(this.bestChain, chain);
    this.refill();
    this.ensureMove();
    return { ok: true, gained: total, chain, combo: this.combo };
  }

  /** 실제 경과 시간을 넣는다. 곡이 끝나면 이펙터를 고르는 중이 되거나(앙코르면) 공연이 끝난다. */
  advance(dtMs: number): void {
    if (this.status !== 'running') return;
    const dt = Math.min(Math.max(0, Number.isFinite(dtMs) ? dtMs : 0), this.remainingMs);
    this.elapsedMs += dt;
    this.remainingMs -= dt;
    if (this.remainingMs > 0) return;
    this.events.push({ type: 'waveEnd', index: this.waveIdx, ratio: this.waveRatio(this.waveIdx) });
    if (this.waveIdx >= M.waves.length - 1) {
      this.status = 'finished';
      this.events.push({ type: 'end' });
      return;
    }
    this.offers = this.drawOffers();
    if (this.offers.length === 0) {
      this.startNextWave();
      return;
    }
    this.status = 'picking';
    this.events.push({ type: 'pick', offers: [...this.offers] });
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

  private startNextWave(): void {
    this.waveIdx += 1;
    this.remainingMs = this.waveMs(this.waveIdx);
    this.status = 'running';
    this.events.push({ type: 'wave', index: this.waveIdx });
    this.ensureMove();
  }

  /** 아직 한도에 안 찬 이펙터 중 offers개를 씨앗으로 고른다 */
  private drawOffers(): EffectId[] {
    const rng = mulberry32(mix(this.seed, 500 + this.waveIdx));
    const pool = EFFECT_IDS.filter((id) => this.effects[id] < M.effectMax[id]);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, M.offers);
  }

  /** 새로 채워질 응원봉 하나: 어둠은 야유꾼이 섞이고, 코러스가 있으면 2단계로 나오기도 한다. */
  private spawn(): number {
    const p = M.persona[this.persona];
    if (p.heckleMax > 0 && this.countOf(HECKLER) < p.heckleMax && this.rng() < p.heckleChance[this.waveIdx]) return HECKLER;
    const color = 1 + Math.floor(this.rng() * M.colors);
    const upgraded = this.chorusChance > 0 && this.rng() < this.chorusChance;
    return codeOf(upgraded ? 2 : 1, color);
  }

  private countOf(v: number): number {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (this.board[i] === v) n++;
    return n;
  }

  private refill(): void {
    for (let i = 0; i < CELLS; i++) if (this.board[i] === 0) this.board[i] = this.spawn();
  }

  /** 합친 묶음에 붙어 있는 야유꾼을 지운다. 지운 수를 돌려준다. */
  private clearHecklersAround(group: number[]): number {
    const gone = new Set<number>();
    for (const c of group) for (const n of neighbors(c)) if (this.board[n] === HECKLER) gone.add(n);
    if (gone.size === 0) return 0;
    for (const n of gone) this.board[n] = 0;
    this.heckled += gone.size;
    this.events.push({ type: 'heckle', cells: [...gone] });
    return gone.size;
  }

  /** 합칠 수 있는 묶음이 없으면 1단계 응원봉 색을 다시 섞고, 그래도 없으면 이어진 세 칸을 1단계로 바꿔서 한 수는 남긴다. */
  private ensureMove(): void {
    if (mergeableCells(this.board, this.minGroup).size > 0) return;
    this.events.push({ type: 'reshuffle' });
    for (let t = 0; t < M.reshuffleTries; t++) {
      for (let i = 0; i < CELLS; i++) if (levelOf(this.board[i]) === 1 && this.board[i] !== HECKLER) this.board[i] = codeOf(1, 1 + Math.floor(this.rng() * M.colors));
      if (mergeableCells(this.board, this.minGroup).size > 0) return;
    }
    const color = 1 + Math.floor(this.rng() * M.colors);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c + 2 < SIZE; c++) {
        const line = [r * SIZE + c, r * SIZE + c + 1, r * SIZE + c + 2];
        if (line.some((i) => this.board[i] === HECKLER)) continue;
        for (const i of line) this.board[i] = codeOf(1, color);
        return;
      }
    }
    for (let i = 0; i < CELLS; i++) if (this.board[i] === HECKLER) this.board[i] = codeOf(1, color);
  }
}

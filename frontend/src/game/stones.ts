import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 삼도천 징검다리: 비밀 공연장 「저세상 공연페스티벌」의 직접 공연. 3칸 폭 강의 징검다리를 박자에 맞춰 한 줄씩 건너고, 뒤에서 삼도천 물이 쫓아온다.
 * 줄은 씨앗 난수로 만들고 어느 돌에서든 다음 줄로 이어지게 한다(막다른 길 없음). 시간은 실제 경과 시간을 그대로 받는다.
 * 수치와 규칙 설명은 balance.ts의 BALANCE.stones.
 */

const B = BALANCE.stones;
export const COLS = 3;

export type Cell = 'water' | 'stone' | 'lotus' | 'fire';
export type StonesStatus = 'running' | 'finished';
/** 뛴 순간의 박자 판정 */
export type BeatGrade = 'perfect' | 'good' | 'off';

export type StonesEvent =
  | { type: 'hop'; col: number; row: number; grade: BeatGrade; points: number; lotus: boolean }
  | { type: 'splash' }
  | { type: 'burn' }
  | { type: 'swept' }
  | { type: 'beat'; strong: boolean }
  | { type: 'wave'; index: number }
  | { type: 'waveEnd'; index: number; ratio: number }
  | { type: 'end' };

export interface StonesSummary {
  hops: number;
  /** 박자에 딱 맞게(perfect) 뛴 횟수 */
  onBeat: number;
  good: number;
  bestStreak: number;
  lotuses: number;
  splashes: number;
  burns: number;
  swept: number;
  /** 도착한 줄 */
  rows: number;
  heartsLeft: number;
  died: boolean;
  /** 곡별 열기 달성률(%, 100이 상한) */
  waves: number[];
  seconds: number;
}

/** 설 수 있는 칸(도깨비불 붙은 돌도 선 채로 이어서 뛸 수 있다) */
const standable = (c: Cell): boolean => c !== 'water';

/** 비어 있지 않은 칸 조합 7가지(비트 마스크 1~7) */
const MASKS = [1, 2, 3, 4, 5, 6, 7] as const;
const colsOf = (mask: number): number[] => [0, 1, 2].filter((c) => (mask & (1 << c)) !== 0);

/**
 * 다음 줄을 만든다. 앞줄에서 설 수 있는 모든 칸(돌·연꽃·도깨비불 붙은 돌)에서 한 칸 안에 닿는 발판이 있는 조합만 고르므로 막다른 길이 없다.
 * 줄이 내려갈수록 돌이 하나뿐인 줄이 늘고 도깨비불(발판이 아닌 칸에 붙는다)이 생긴다.
 */
export function makeRow(prev: readonly Cell[], index: number, rng: () => number): Cell[] {
  const prevSafe = prev.map((c, i) => (standable(c) ? i : -1)).filter((i) => i >= 0);
  const ok = MASKS.filter((m) => {
    const cols = colsOf(m);
    return prevSafe.every((p) => cols.some((c) => Math.abs(c - p) <= 1));
  });
  const single = Math.min(B.singleMax, B.singleBase + index * B.singleStep);
  const weights = ok.map((m) => {
    const n = colsOf(m).length;
    return n === 1 ? single : n === 2 ? (1 - single) * 0.8 : (1 - single) * 0.2;
  });
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  let mask = ok[ok.length - 1];
  for (let i = 0; i < ok.length; i++) {
    r -= weights[i];
    if (r < 0) {
      mask = ok[i];
      break;
    }
  }
  const fireP = index < B.fireFrom ? 0 : Math.min(B.fireMax, (index - B.fireFrom) * B.fireStep);
  const row: Cell[] = [];
  for (let c = 0; c < COLS; c++) {
    if (mask & (1 << c)) row.push(rng() < B.lotusChance ? 'lotus' : 'stone');
    else row.push(rng() < fireP ? 'fire' : 'water');
  }
  return row;
}

export class StonesGame {
  readonly persona: Persona;
  readonly seed: number;
  status: StonesStatus = 'running';
  waveIdx = 0;
  waveMs = 0;
  elapsedMs = 0;
  /** 줄 번호 0부터. 0줄은 출발점이다. */
  rows: Cell[][] = [['water', 'stone', 'water']];
  row = 0;
  col = 1;
  hearts: number = B.hearts;
  /** 쫓아오는 물이 닿은 줄(소수). 내 줄에 닿으면 쓸려 간다. */
  waterRow: number = -B.startGap;
  /** 이 시간 동안 움직일 수 없다(풍덩·도깨비불·쓸려 감) */
  stunLeftMs = 0;
  /** 뛴 직후 입력을 무시하는 남은 시간 */
  lockLeftMs = 0;
  streak = 0;
  bestStreak = 0;
  hops = 0;
  onBeatHops = 0;
  goodHops = 0;
  lotuses = 0;
  splashes = 0;
  burns = 0;
  sweptCount = 0;
  died = false;
  /** 곡별로 얻은 점수 */
  points: number[] = B.waves.map(() => 0);
  ratios: number[] = [];
  /** 바뀔 때마다 오르는 번호 */
  rev = 0;
  /** 화면·효과음용 사건. 읽는 쪽이 비운다. */
  events: StonesEvent[] = [];
  private rng: () => number;
  private nextBeatAt = 0;
  private beatNo = 0;

  constructor(persona: Persona, seed: number) {
    this.persona = persona;
    this.seed = seed >>> 0;
    this.rng = mulberry32(mix(this.seed, 3003));
    this.ensureRows(B.ahead);
  }

  get over(): boolean {
    return this.status === 'finished';
  }
  get remainingMs(): number {
    return Math.max(0, B.waves[this.waveIdx].ms - this.waveMs);
  }
  get beatMs(): number {
    return 60_000 / B.bpm[this.waveIdx];
  }
  get goal(): number {
    return B.goals[this.waveIdx];
  }
  /** 물과 내 줄 사이의 간격(줄) */
  get gap(): number {
    return this.row - this.waterRow;
  }
  get stunned(): boolean {
    return this.stunLeftMs > 0;
  }
  /** 지금 뛰면 받을 박자 판정 */
  get grade(): BeatGrade {
    const beat = this.beatMs;
    const phase = this.waveMs % beat;
    const d = Math.min(phase, beat - phase);
    return d <= beat * B.beatWindow ? 'perfect' : d <= beat * B.beatWindow * 2 ? 'good' : 'off';
  }
  get locked(): boolean {
    return this.lockLeftMs > 0;
  }
  waveRatio(i: number): number {
    if (i < this.ratios.length) return this.ratios[i];
    if (i > this.waveIdx || this.status === 'finished') return 0;
    return Math.max(0, Math.min(1, this.points[i] / B.goals[i]));
  }
  get score(): number {
    let sum = 0;
    for (let i = 0; i < B.waves.length; i++) sum += B.waveScore * this.waveRatio(i);
    return Math.round(sum);
  }
  get cleared(): boolean {
    return this.score >= BALANCE.concert.clearScore;
  }
  get summary(): StonesSummary {
    return {
      hops: this.hops,
      onBeat: this.onBeatHops,
      good: this.goodHops,
      bestStreak: this.bestStreak,
      lotuses: this.lotuses,
      splashes: this.splashes,
      burns: this.burns,
      swept: this.sweptCount,
      rows: this.row,
      heartsLeft: this.hearts,
      died: this.died,
      waves: B.waves.map((_, i) => Math.round(this.waveRatio(i) * 100)),
      seconds: Math.round(this.elapsedMs / 1000),
    };
  }

  private emit(e: StonesEvent): void {
    this.events.push(e);
    this.rev++;
  }

  private ensureRows(upto: number): void {
    while (this.rows.length <= upto + this.row) this.rows.push(makeRow(this.rows[this.rows.length - 1], this.rows.length, this.rng));
  }

  private hurt(): void {
    this.hearts--;
    this.streak = 0;
    if (this.hearts <= 0) {
      this.died = true;
      this.finishRun();
    }
  }

  /** 하트가 다 닳았을 때: 끝난 곡은 그대로, 진행 중인 곡은 지금까지의 점수로 확정하고 끝낸다. */
  private finishRun(): void {
    while (this.ratios.length < B.waves.length) {
      const i = this.ratios.length;
      this.ratios.push(i === this.waveIdx ? Math.max(0, Math.min(1, this.points[i] / B.goals[i])) : 0);
    }
    this.status = 'finished';
    this.emit({ type: 'end' });
  }

  /**
   * 칸을 눌러 한 줄 앞으로 뛴다. 한 번에 옆 칸까지만 갈 수 있어서 더 먼 칸을 누르면 그쪽으로 한 칸 간다.
   * 움직일 수 없는 동안(풍덩·도깨비불·쓸려 감 직후)에는 무시된다. 뛰었으면 true.
   */
  hop(targetCol: number): boolean {
    if (this.status !== 'running' || this.stunned || this.locked) return false;
    const col = Math.max(this.col - 1, Math.min(this.col + 1, Math.max(0, Math.min(COLS - 1, Math.round(targetCol)))));
    this.ensureRows(B.ahead + 1);
    const cell = this.rows[this.row + 1][col];
    if (cell === 'water') {
      this.splashes++;
      this.stunLeftMs = B.swampStunMs;
      this.emit({ type: 'splash' });
      this.hurt();
      return true;
    }
    const grade = this.grade;
    this.row++;
    this.col = col;
    this.hops++;
    this.ensureRows(B.ahead);
    if (cell === 'fire') {
      this.burns++;
      this.stunLeftMs = B.burnStunMs;
      this.emit({ type: 'burn' });
      this.hurt();
      return true;
    }
    const lotus = cell === 'lotus';
    const points = B.hopPoints[grade] + (lotus && grade !== 'off' ? B.lotusBonus : 0);
    this.points[this.waveIdx] = Math.max(0, this.points[this.waveIdx] + points);
    this.lockLeftMs = this.beatMs * B.hopLock;
    if (lotus) this.lotuses++;
    if (grade === 'perfect') {
      this.onBeatHops++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      if (grade === 'good') this.goodHops++;
      this.streak = 0;
    }
    this.emit({ type: 'hop', col, row: this.row, grade, points, lotus });
    return true;
  }

  private startWave(i: number): void {
    this.waveIdx = i;
    this.waveMs = 0;
    this.nextBeatAt = 0;
    this.beatNo = 0;
    this.emit({ type: 'wave', index: i });
  }

  private endWave(): void {
    const ratio = this.waveRatio(this.waveIdx);
    this.ratios.push(ratio);
    this.emit({ type: 'waveEnd', index: this.waveIdx, ratio });
    if (this.waveIdx + 1 >= B.waves.length) {
      this.status = 'finished';
      this.emit({ type: 'end' });
    } else {
      this.startWave(this.waveIdx + 1);
    }
  }

  /** 실제 경과 시간을 넣는다. 박자, 쫓아오는 물, 움직일 수 없는 시간, 곡 전환을 시간 순서대로 처리한다. */
  advance(dtMs: number): void {
    let left = Math.max(0, dtMs);
    while (left > 0 && this.status === 'running') {
      const room = B.waves[this.waveIdx].ms - this.waveMs;
      const step = Math.min(left, room, 50);
      this.waveMs += step;
      this.elapsedMs += step;
      left -= step;
      this.stunLeftMs = Math.max(0, this.stunLeftMs - step);
      this.lockLeftMs = Math.max(0, this.lockLeftMs - step);
      while (this.nextBeatAt <= this.waveMs) {
        this.emit({ type: 'beat', strong: this.beatNo % 4 === 0 });
        this.beatNo++;
        this.nextBeatAt += this.beatMs;
      }
      this.waterRow += (B.waterSpeed[this.waveIdx] * step) / 1000;
      if (this.waterRow >= this.row) {
        this.sweptCount++;
        this.waterRow = this.row - B.sweptGap;
        this.stunLeftMs = Math.max(this.stunLeftMs, B.sweptStunMs);
        this.emit({ type: 'swept' });
        this.hurt();
        if (this.status !== 'running') return;
      }
      if (this.waveMs >= B.waves[this.waveIdx].ms - 1e-9) this.endWave();
    }
  }
}

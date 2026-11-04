import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 정전 속 박자: 비밀 공연장 「폐건물 지하공연」의 직접 공연. 전기가 끊긴 지하에서 하는 4레인 리듬 게임이다.
 * 노트는 어둠에 가려져 판정선에 가까워진 것만 보이고(콤보가 쌓일수록 멀리까지 보인다), 박자음은 계속 들린다.
 * 규칙은 React·DOM과 무관하고 채보는 씨앗 난수로만 정해진다. 수치와 규칙 설명은 balance.ts의 BALANCE.blackout.
 */

const B = BALANCE.blackout;
export const LANES = B.lanes;

export type BlackoutStatus = 'running' | 'finished';
export type HitJudge = 'perfect' | 'good';

export interface BlackoutNote {
  /** 곡이 시작하고 나서 판정선에 닿는 시각(ms) */
  t: number;
  lane: number;
  /** 아직 판정 전이면 null */
  result: HitJudge | 'miss' | null;
}

export type BlackoutEvent =
  | { type: 'beat'; strong: boolean }
  | { type: 'hit'; lane: number; judge: HitJudge; combo: number }
  | { type: 'miss'; lane: number }
  | { type: 'stray'; lane: number }
  | { type: 'wave'; index: number }
  | { type: 'waveEnd'; index: number; ratio: number }
  | { type: 'end' };

export interface BlackoutSummary {
  perfect: number;
  good: number;
  miss: number;
  stray: number;
  bestCombo: number;
  notes: number;
  /** 곡별 점수 비율(%, 100이 상한) */
  waves: number[];
  seconds: number;
}

export const beatMsOf = (wave: number): number => 60_000 / B.bpm[wave];

/** 곡 하나의 채보. 같은 씨앗·곡 번호면 항상 같다. 같은 레인이 한 박 안에 연달아 나오지 않게 하고, 노트가 너무 오래 비지 않게 한다. */
export function buildWaveNotes(seed: number, wave: number): { t: number; lane: number }[] {
  const rng = mulberry32(mix(seed >>> 0, 7000 + wave));
  const beat = beatMsOf(wave);
  const eighth = beat / 2;
  const end = B.waves[wave].ms - B.tailMs;
  const notes: { t: number; lane: number }[] = [];
  let lastLanes: number[] = [];
  let lastT = -1e9;
  let empty = 0;
  for (let k = 0; ; k++) {
    const t = B.leadInMs + k * eighth;
    if (t > end) break;
    if (empty < 3 && rng() >= B.density[wave]) {
      empty++;
      continue;
    }
    empty = 0;
    // 한 박 안에 방금 나온 레인과 같은 레인이 또 나오지 않게 고른다
    const free = Array.from({ length: LANES }, (_, l) => l).filter((l) => !(t - lastT < beat && lastLanes.includes(l)));
    const lane = free[Math.floor(rng() * free.length)];
    notes.push({ t: Math.round(t), lane });
    const used = [lane];
    if (rng() < B.doubleChance[wave]) {
      const others = free.filter((l) => l !== lane);
      const other = others[Math.floor(rng() * others.length)];
      notes.push({ t: Math.round(t), lane: other });
      used.push(other);
    }
    lastLanes = used;
    lastT = t;
  }
  return notes;
}

export class BlackoutGame {
  readonly persona: Persona;
  readonly seed: number;
  status: BlackoutStatus = 'running';
  waveIdx = 0;
  waveMs = 0;
  elapsedMs = 0;
  combo = 0;
  bestCombo = 0;
  perfect = 0;
  good = 0;
  miss = 0;
  stray = 0;
  /** 지금 곡의 노트(판정 결과가 붙는다) */
  notes: BlackoutNote[] = [];
  /** 끝난 곡의 점수 비율 */
  ratios: number[] = [];
  /** 곡별 노트 수 */
  totalNotes = 0;
  /** 바뀔 때마다 오르는 번호 */
  rev = 0;
  /** 화면·효과음용 사건. 읽는 쪽이 비운다. */
  events: BlackoutEvent[] = [];
  private nextBeatAt = 0;
  private beatNo = 0;
  private waveHits = { perfect: 0, good: 0, stray: 0 };

  constructor(persona: Persona, seed: number) {
    this.persona = persona;
    this.seed = seed >>> 0;
    this.startWave(0);
  }

  get over(): boolean {
    return this.status === 'finished';
  }
  get remainingMs(): number {
    return Math.max(0, B.waves[this.waveIdx].ms - this.waveMs);
  }
  /** 어둠 속에서 보이는 거리(ms): 콤보가 쌓일수록 멀리 보인다. */
  get lookAheadMs(): number {
    return B.baseLookMs + B.lookPerCombo * Math.min(this.combo, B.comboCap);
  }
  get beatMs(): number {
    return beatMsOf(this.waveIdx);
  }
  /** 지금 곡의 점수 비율(0~1). 끝난 곡이면 확정된 값, 진행 중이면 지금까지의 판정으로 계산한 값. */
  waveRatio(i: number): number {
    if (i < this.ratios.length) return this.ratios[i];
    if (i > this.waveIdx || this.status === 'finished') return 0;
    return this.liveRatio();
  }
  private liveRatio(): number {
    const h = this.waveHits;
    const weighted = h.perfect + h.good * B.goodWeight - h.stray * B.strayPenalty;
    return Math.max(0, Math.min(1, weighted / (this.totalNotes * B.goalRate)));
  }
  get score(): number {
    let sum = 0;
    for (let i = 0; i < B.waves.length; i++) sum += B.waveScore * this.waveRatio(i);
    return Math.round(sum);
  }
  get cleared(): boolean {
    return this.score >= BALANCE.concert.clearScore;
  }
  get summary(): BlackoutSummary {
    return {
      perfect: this.perfect,
      good: this.good,
      miss: this.miss,
      stray: this.stray,
      bestCombo: this.bestCombo,
      notes: this.notesTotal,
      waves: B.waves.map((_, i) => Math.round(this.waveRatio(i) * 100)),
      seconds: Math.round(this.elapsedMs / 1000),
    };
  }
  /** 지금까지 시작한 곡들의 노트 수 합 */
  private notesTotal = 0;

  private emit(e: BlackoutEvent): void {
    this.events.push(e);
    this.rev++;
  }

  private startWave(i: number): void {
    this.waveIdx = i;
    this.waveMs = 0;
    this.notes = buildWaveNotes(this.seed, i).map((n) => ({ ...n, result: null }));
    this.totalNotes = this.notes.length;
    this.notesTotal += this.notes.length;
    this.waveHits = { perfect: 0, good: 0, stray: 0 };
    // 박자는 첫 노트 시각을 한 박 격자의 기준으로 삼아 0초 이후의 첫 박부터 울린다.
    const beat = this.beatMs;
    const first = B.leadInMs % beat;
    this.nextBeatAt = first;
    this.beatNo = -Math.floor(B.leadInMs / beat);
    if (i > 0) this.emit({ type: 'wave', index: i });
  }

  private endWave(): void {
    for (const n of this.notes) {
      if (n.result === null) {
        n.result = 'miss';
        this.miss++;
        this.combo = 0;
      }
    }
    const ratio = this.liveRatio();
    this.ratios.push(ratio);
    this.emit({ type: 'waveEnd', index: this.waveIdx, ratio });
    if (this.waveIdx + 1 >= B.waves.length) {
      this.status = 'finished';
      this.emit({ type: 'end' });
    } else {
      this.startWave(this.waveIdx + 1);
    }
  }

  /** 레인을 눌렀다. 그 레인에서 가장 가까운 노트가 판정 폭 안이면 맞은 것이고, 아니면 헛손질이다. */
  tap(lane: number): void {
    if (this.status !== 'running' || lane < 0 || lane >= LANES) return;
    let best: BlackoutNote | null = null;
    let bestD = Infinity;
    for (const n of this.notes) {
      if (n.lane !== lane || n.result !== null) continue;
      const d = Math.abs(n.t - this.waveMs);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    if (!best || bestD > B.goodMs) {
      this.stray++;
      this.waveHits.stray++;
      this.combo = 0;
      this.emit({ type: 'stray', lane });
      return;
    }
    const judge: HitJudge = bestD <= B.perfectMs ? 'perfect' : 'good';
    best.result = judge;
    if (judge === 'perfect') {
      this.perfect++;
      this.waveHits.perfect++;
    } else {
      this.good++;
      this.waveHits.good++;
    }
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.emit({ type: 'hit', lane, judge, combo: this.combo });
  }

  /** 실제 경과 시간을 넣는다. 박자·놓친 노트·곡 전환을 시간 순서대로 처리한다. */
  advance(dtMs: number): void {
    let left = Math.max(0, dtMs);
    while (left > 0 && this.status === 'running') {
      const room = B.waves[this.waveIdx].ms - this.waveMs;
      const step = Math.min(left, room);
      this.waveMs += step;
      this.elapsedMs += step;
      left -= step;
      const beat = this.beatMs;
      while (this.nextBeatAt <= this.waveMs) {
        this.emit({ type: 'beat', strong: ((this.beatNo % 4) + 4) % 4 === 0 });
        this.beatNo++;
        this.nextBeatAt += beat;
      }
      for (const n of this.notes) {
        if (n.result === null && n.t + B.goodMs < this.waveMs) {
          n.result = 'miss';
          this.miss++;
          this.combo = 0;
          this.emit({ type: 'miss', lane: n.lane });
        }
      }
      if (this.waveMs >= B.waves[this.waveIdx].ms) this.endWave();
    }
  }
}

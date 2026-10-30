import { BALANCE } from './balance';
import type { RhythmLevel } from './arcade';
import type { Judgement } from './minigame';
import { mulberry32 } from './runner';
import type { Persona } from './types';

/*
 * 리듬게임: 싱글마다 곡 번호와 씨앗으로 채보(4레인 탭 노트)가 자동 생성된다. 판정은 마이크 타이밍과 같은 시계(ms)다.
 * 점수 = 1000 × (정확도 × (1 − comboWeight) + 최대 콤보 비율 × comboWeight).
 */

const R = BALANCE.rhythm;

export interface Note {
  t: number;
  lane: number;
}

export interface Chart {
  persona: Persona;
  level: RhythmLevel;
  bpm: number;
  notes: Note[];
  durationMs: number;
}

/** 같은 씨앗·난이도·자아면 항상 같은 채보가 나온다. 레인이 같은 노트가 너무 가까이 붙지 않게 한다. */
export function buildChart(seed: number, persona: Persona, level: RhythmLevel): Chart {
  const cfg = R.levels[level];
  const rng = mulberry32(seed);
  rng();
  const bpm = cfg.bpm + (persona === 'dark' ? R.darkBpm : 0) + Math.floor(rng() * 9) - 4;
  const beatMs = 60_000 / bpm;
  const notes: Note[] = [];
  let lastLane = -1;
  const lastAt = new Array<number>(R.lanes).fill(-1e9);
  const put = (t: number) => {
    let lane = Math.floor(rng() * R.lanes);
    if (lane === lastLane) lane = (lane + 1 + Math.floor(rng() * (R.lanes - 1))) % R.lanes;
    if (t - lastAt[lane] < beatMs * 0.45) lane = (lane + 1) % R.lanes;
    lastLane = lane;
    lastAt[lane] = t;
    notes.push({ t: Math.round(t), lane });
  };
  for (let b = 0; b < cfg.beats; b++) {
    const t = R.leadInMs + b * beatMs;
    // 박마다 밀도만큼의 확률로 한 개, 밀도가 1을 넘으면 반 박 노트도 얹힌다.
    if (rng() < Math.min(1, cfg.density)) put(t);
    if (cfg.density > 1 && rng() < cfg.density - 1) put(t + beatMs / 2);
    else if (cfg.density <= 1 && b % 4 === 3 && rng() < cfg.density * 0.35) put(t + beatMs / 2);
  }
  notes.sort((a, c) => a.t - c.t || a.lane - c.lane);
  return { persona, level, bpm, notes, durationMs: (notes[notes.length - 1]?.t ?? R.leadInMs) + R.tailMs };
}

export interface RhythmState {
  chart: Chart;
  /** 전투력 보너스만큼 넓어지는 판정 폭 배율 */
  windowMult: number;
  elapsedMs: number;
  results: (Judgement | null)[];
  combo: number;
  maxCombo: number;
}

export function createRhythm(chart: Chart, power = 0): RhythmState {
  return { chart, windowMult: 1 + Math.max(0, power), elapsedMs: 0, results: chart.notes.map(() => null), combo: 0, maxCombo: 0 };
}

export const judgeWindowsOf = (s: Pick<RhythmState, 'windowMult'>) => ({ perfectMs: R.perfectMs * s.windowMult, goodMs: R.goodMs * s.windowMult });

/** 시간을 tMs까지 진행하고, 좋음 판정 폭을 지난 노트를 Miss로 확정한다. */
export function tickTo(s: RhythmState, tMs: number): RhythmState {
  if (!(tMs > s.elapsedMs)) return s;
  const { goodMs } = judgeWindowsOf(s);
  let results = s.results;
  let combo = s.combo;
  for (let i = 0; i < s.chart.notes.length; i++) {
    if (results[i] === null && tMs > s.chart.notes[i].t + goodMs) {
      if (results === s.results) results = [...results];
      results[i] = 'miss';
      combo = 0;
    }
  }
  return { ...s, elapsedMs: tMs, results, combo };
}

/** tMs 시점에 lane을 누른다. 그 레인에서 판정 폭 안에 있는 가장 이른 미판정 노트를 확정한다. 노트가 없으면 아무 일도 없다(헛누름 감점 없음). */
export function pressLane(s: RhythmState, lane: number, tMs: number): { state: RhythmState; judgement: Judgement | null } {
  const advanced = tickTo(s, tMs);
  const { perfectMs, goodMs } = judgeWindowsOf(advanced);
  const t = Math.max(advanced.elapsedMs, tMs);
  let hit = -1;
  for (let i = 0; i < advanced.chart.notes.length; i++) {
    const n = advanced.chart.notes[i];
    if (n.t - goodMs > t) break;
    if (advanced.results[i] === null && n.lane === lane && Math.abs(t - n.t) <= goodMs) {
      hit = i;
      break;
    }
  }
  if (hit < 0) return { state: advanced, judgement: null };
  const judgement: Judgement = Math.abs(t - advanced.chart.notes[hit].t) <= perfectMs ? 'perfect' : 'good';
  const results = [...advanced.results];
  results[hit] = judgement;
  const combo = advanced.combo + 1;
  return { state: { ...advanced, results, combo, maxCombo: Math.max(advanced.maxCombo, combo) }, judgement };
}

export const isRhythmFinished = (s: RhythmState): boolean => s.elapsedMs >= s.chart.durationMs;

export function tally(s: RhythmState): Record<Judgement, number> {
  const out: Record<Judgement, number> = { perfect: 0, good: 0, miss: 0 };
  for (const r of s.results) if (r) out[r]++;
  return out;
}

/** 아직 판정되지 않은 노트는 Miss로 센다. */
export function rhythmScore(s: RhythmState): number {
  const total = s.chart.notes.length;
  if (total === 0) return 0;
  const t = tally(s);
  const accuracy = (t.perfect + t.good * R.goodValue) / total;
  return Math.round(1000 * (accuracy * (1 - R.comboWeight) + (s.maxCombo / total) * R.comboWeight));
}

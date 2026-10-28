import { BALANCE } from './balance';
import type { Persona } from './types';

/* 마이크 타이밍: 10개의 타이밍 과제. 과제 간격은 점점 짧아진다. 모든 판정은 minigame 시계(ms)만 쓴다. */

export type Judgement = 'perfect' | 'good' | 'miss';

export interface MinigameState {
  persona: Persona;
  /** 공연장 난이도. 판정 폭이 난이도에 반비례해 좁아진다. */
  difficulty: number;
  /** 과제를 하나 넘길 때마다 난이도에 곱해지는 배수. 공연장마다 다를 수 있다. */
  taskGrowth: number;
  /** 지금까지 진행된 미니게임 시간(ms). 일시정지 중에는 늘지 않는다. */
  elapsedMs: number;
  results: (Judgement | null)[];
}

const C = BALANCE.concert;

/** i번째(0부터) 과제 직전 간격(ms). 뒤로 갈수록 paceGrowth배씩 빨라진다. 첫 과제는 기준 간격. */
export const gapBefore = (i: number) => C.taskIntervalMs / C.paceGrowth ** Math.max(0, i - 1);

const TARGETS: readonly number[] = (() => {
  const out: number[] = [];
  let t: number = C.firstTargetMs;
  for (let i = 0; i < C.taskCount; i++) {
    if (i > 0) t += gapBefore(i);
    out.push(Math.round(t));
  }
  return out;
})();

export const targetMs = (i: number) => TARGETS[i];

/** 공연 전체 길이(ms): 마지막 목표 + 여유 */
export const durationMs = TARGETS[C.taskCount - 1] + C.tailMs;

/** i번째 과제의 입력 구간(±ms). 이웃 과제 구간과 겹치지 않게 간격의 절반을 넘지 않는다. */
export const inputWindowMs = (i: number): number => {
  const before = i > 0 ? (TARGETS[i] - TARGETS[i - 1]) / 2 : Infinity;
  const after = i < C.taskCount - 1 ? (TARGETS[i + 1] - TARGETS[i]) / 2 : Infinity;
  return Math.min(C.windowMs, Math.floor(before), Math.floor(after));
};

/** 화면의 접근 링이 목표까지 날아오는 시간(ms). 간격이 줄면 같이 짧아져 눈에 보이는 속도가 빨라진다. */
export const approachMs = (i: number) => (1000 * gapBefore(i)) / C.taskIntervalMs;

/** 박자음 시각표: 목표 사이마다 약박 하나, 목표에서 강박. 템포가 빨라지면 박자도 같이 빨라진다. */
export const BEATS: readonly { t: number; accent: boolean }[] = (() => {
  const out = [{ t: 0, accent: true }];
  for (let i = 0; i < C.taskCount; i++) {
    const prev = i === 0 ? 0 : TARGETS[i - 1];
    out.push({ t: Math.round((prev + TARGETS[i]) / 2), accent: false }, { t: TARGETS[i], accent: true });
  }
  return out;
})();

export function createMinigame(persona: Persona, difficulty = 1, taskGrowth: number = C.taskDifficultyGrowth): MinigameState {
  return { persona, difficulty, taskGrowth, elapsedMs: 0, results: Array.from({ length: C.taskCount }, () => null) };
}

/** i번째(0부터) 과제의 실제 난이도: 공연장 난이도에 과제를 넘길 때마다 growth배(기본 taskDifficultyGrowth)가 쌓인다. */
export const taskDifficulty = (difficulty: number, i: number, growth: number = C.taskDifficultyGrowth) => difficulty * growth ** i;

/** 난이도를 반영한 판정 폭(±ms). 판정과 화면 표시가 같은 값을 쓴다. 과제별 난이도는 taskDifficulty로 넘긴다. */
export function judgeWindows(persona: Persona, difficulty = 1): { perfectMs: number; goodMs: number } {
  const d = Math.max(difficulty, 0.01);
  return { perfectMs: Math.round(C.perfectMs / d), goodMs: Math.round(C.goodMs[persona] / d) };
}

/** difficulty는 해당 과제에 적용되는 난이도(공연장 난이도 × 과제 배수)다. */
export function judge(persona: Persona, deltaMs: number, difficulty = 1): Judgement {
  const d = Math.abs(deltaMs);
  const w = judgeWindows(persona, difficulty);
  if (d <= w.perfectMs) return 'perfect';
  if (d <= w.goodMs) return 'good';
  return 'miss';
}

/** 시간을 tMs까지 진행시키고, 입력 구간이 끝난 미판정 과제를 Miss로 확정한다. */
export function tickTo(mg: MinigameState, tMs: number): MinigameState {
  if (!(tMs > mg.elapsedMs)) return mg;
  let results = mg.results;
  for (let i = 0; i < C.taskCount; i++) {
    if (results[i] === null && tMs > targetMs(i) + inputWindowMs(i)) {
      if (results === mg.results) results = [...results];
      results[i] = 'miss';
    }
  }
  return { ...mg, elapsedMs: tMs, results };
}

/**
 * tMs 시점의 입력. 입력 구간(최대 ±500ms)에 든 아직 판정되지 않은 과제 하나를 확정한다.
 * 구간 바깥 입력과 이미 판정된 과제로의 추가 입력은 점수에 영향이 없다.
 */
export function pressAt(mg: MinigameState, tMs: number): MinigameState {
  const advanced = tickTo(mg, tMs);
  const t = Math.max(advanced.elapsedMs, tMs);
  for (let i = 0; i < C.taskCount; i++) {
    const delta = t - targetMs(i);
    if (Math.abs(delta) <= inputWindowMs(i)) {
      if (advanced.results[i] !== null) return advanced;
      const results = [...advanced.results];
      results[i] = judge(mg.persona, delta, taskDifficulty(mg.difficulty, i, mg.taskGrowth));
      return { ...advanced, results };
    }
  }
  return advanced;
}

export const isFinished = (mg: MinigameState) => mg.elapsedMs >= durationMs;

export function scoreOf(mg: MinigameState): number {
  return mg.results.reduce<number>(
    (sum, r) => sum + (r === 'perfect' ? C.perfectScore : r === 'good' ? C.goodScore : 0),
    0,
  );
}

export function tally(mg: MinigameState): Record<Judgement, number> {
  const out: Record<Judgement, number> = { perfect: 0, good: 0, miss: 0 };
  for (const r of mg.results) if (r) out[r]++;
  return out;
}

/** 다음에 입력을 받을 수 있는 과제 번호(시각 표시용). 없으면 null. */
export function currentTask(mg: MinigameState): number | null {
  for (let i = 0; i < C.taskCount; i++) {
    if (mg.results[i] === null && mg.elapsedMs <= targetMs(i) + inputWindowMs(i)) return i;
  }
  return null;
}

/**
 * 미니게임 전용 시계. 탭이 숨겨져 일시정지된 동안에는 흐르지 않고,
 * 한 프레임 간격이 maxStepMs를 넘으면 그만큼만 진행해 복귀 직후 가짜 Miss가 생기지 않게 한다.
 */
export class MinigameClock {
  private elapsed = 0;
  private last: number | null = null;
  private paused = false;

  constructor(private readonly maxStepMs = 250) {}

  start(nowPerf: number): void {
    this.elapsed = 0;
    this.last = nowPerf;
    this.paused = false;
  }

  /** 현재 미니게임 시간(ms)을 갱신해서 돌려준다. */
  read(nowPerf: number): number {
    if (this.paused || this.last === null) return this.elapsed;
    const delta = Math.max(0, nowPerf - this.last);
    this.elapsed += Math.min(delta, this.maxStepMs);
    this.last = nowPerf;
    return this.elapsed;
  }

  pause(nowPerf: number): void {
    this.read(nowPerf);
    this.paused = true;
  }

  resume(nowPerf: number): void {
    if (!this.paused) return;
    this.paused = false;
    this.last = nowPerf;
  }

  get isPaused(): boolean {
    return this.paused;
  }
}

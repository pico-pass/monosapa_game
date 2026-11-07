import { BALANCE, NURTURE_TEMP_OPEN, nurtureActionsOf, type NurtureActionDef } from './balance';
import type { NurtureGauge, NurtureSide, Persona } from './types';

/*
 * 모노사파 육성의 순수 데이터 규칙: 게이지가 시간에 따라 변하는 법, 컨디션, 레벨, 레벨 보너스.
 * packdata(영구 보너스 합산)가 쓰므로 다른 game 모듈을 가져오지 않는다. 행동 명령은 nurture.ts에 있다.
 */

const N = BALANCE.nurture;
const HOUR = 3600_000;

export const NURTURE_GAUGES: readonly NurtureGauge[] = ['full', 'mood', 'tired', 'clean'];
export type GaugeValues = Record<NurtureGauge, number>;

export const emptyNurtureSide = (): NurtureSide => ({ xp: 0, ...N.gauge.start, at: 0, sleepUntil: 0, readyAt: {}, uses: {} });

/** 열려 있나: 팬이 unlockFans명 이상이거나 임시 개방 중(NURTURE_TEMP_OPEN)이다. */
export const nurtureUnlocked = (fans: number, tempOpen: boolean = NURTURE_TEMP_OPEN): boolean => tempOpen || fans >= N.unlockFans;

/* ---------- 레벨 ---------- */

/** 레벨 L → L+1에 필요한 성장도 */
export const levelStepXp = (level: number): number => Math.ceil(N.levelXp.base * N.levelXp.growth ** (level - 1));

/** CUMULATIVE[L] = 레벨 L에 닿는 데 필요한 성장도 합계 (레벨 1은 0). 최고 레벨이 없어서 필요한 만큼 늘려 쓴다. */
const CUMULATIVE: number[] = [0, 0];
function cumulative(level: number): number {
  for (let L = CUMULATIVE.length; L <= level; L++) CUMULATIVE[L] = CUMULATIVE[L - 1] + levelStepXp(L - 1);
  return CUMULATIVE[level];
}
export const xpForLevel = (level: number): number => cumulative(Math.max(1, Math.floor(level)));

export function nurtureLevel(xp: number): number {
  let level = 1;
  while (xp >= cumulative(level + 1)) level++;
  return level;
}

export interface LevelProgress {
  level: number;
  /** 이번 레벨에서 쌓은 성장도 */
  into: number;
  /** 다음 레벨까지 필요한 성장도 */
  need: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = nurtureLevel(xp);
  return { level, into: xp - xpForLevel(level), need: levelStepXp(level) };
}

/* ---------- 게이지 ---------- */

const clamp = (v: number): number => Math.min(N.gauge.max, Math.max(0, v));

/** 자는 중인가 */
export const isSleeping = (side: Pick<NurtureSide, 'at' | 'sleepUntil'>, at: number): boolean => side.at > 0 && at < side.sleepUntil;

/**
 * `at` 시각의 게이지 값. 기록된 시각(side.at)부터 자는 구간(sleepUntil까지)과 깨어 있는 구간을 나눠 시간만큼 변화시킨다.
 * 아직 돌본 적이 없으면(side.at이 0) 시작 값 그대로다.
 */
export function gaugesAt(side: NurtureSide, persona: Persona, at: number): GaugeValues {
  let cur: GaugeValues = { full: side.full, mood: side.mood, tired: side.tired, clean: side.clean };
  if (side.at <= 0 || at <= side.at) return cur;
  const rate = N.awake[persona];
  let t = side.at;

  const sleepEnd = Math.min(at, side.sleepUntil);
  if (sleepEnd > t) {
    const h = (sleepEnd - t) / HOUR;
    const f = N.sleep.decayFactor;
    cur = {
      full: clamp(cur.full + rate.full * f * h),
      mood: clamp(cur.mood + rate.mood * f * h),
      tired: clamp(cur.tired - N.sleep.restPerHour * h),
      clean: clamp(cur.clean + rate.clean * f * h),
    };
    t = sleepEnd;
  }
  if (at > t) {
    const h = (at - t) / HOUR;
    cur = {
      full: clamp(cur.full + rate.full * h),
      mood: clamp(cur.mood + rate.mood * h),
      tired: clamp(cur.tired + rate.tired * h),
      clean: clamp(cur.clean + rate.clean * h),
    };
  }
  return cur;
}

/** 컨디션 0~100: 포만감·기분·청결도·(100−피로도)의 평균 */
export const conditionOf = (g: GaugeValues): number => (g.full + g.mood + g.clean + (N.gauge.max - g.tired)) / 4;

/** 컨디션이 성장도에 곱해지는 배율 (efficiency.min ~ efficiency.max) */
export const efficiencyOf = (g: GaugeValues): number => N.efficiency.min + (N.efficiency.max - N.efficiency.min) * (conditionOf(g) / N.gauge.max);

/** 돌봐 줘야 하는 상태인가: 어느 게이지든 바닥(20 이하)이거나 피로가 80 이상 */
export const needsCare = (g: GaugeValues): boolean => g.full <= 20 || g.mood <= 20 || g.clean <= 20 || g.tired >= 80;

/* ---------- 어둠속성 내성 ---------- */

/** 그 레벨에서 열린 가장 센 단계 (술·놀기 사다리별) */
export function topTier(persona: Persona, kind: 'drink' | 'fun', level: number): number {
  let top = 0;
  for (const a of nurtureActionsOf(persona)) if (a.kind === kind && a.unlockLevel <= level) top = Math.max(top, a.tier);
  return top;
}

/** 더 센 단계가 열려 있을 때 낮은 단계의 쾌락·성장도가 줄어드는 배율. 술·놀기가 아니거나 가장 센 단계면 1이다. */
export function toleranceFactor(def: Pick<NurtureActionDef, 'persona' | 'kind' | 'tier'>, level: number): number {
  if (def.kind !== 'drink' && def.kind !== 'fun') return 1;
  const gap = Math.max(0, topTier(def.persona, def.kind, level) - def.tier);
  return Math.max(N.tolerance.min, N.tolerance.perTier ** gap);
}

/* ---------- 레벨 보너스 ---------- */

export interface NurtureBonus {
  level: number;
  /** 그 자아의 라임 생산 */
  rhyme: number;
  /** 그 자아의 인세 */
  coin: number;
  /** 이정표 레벨마다 쌓인 보너스 (일반은 팬 획득, 어둠은 전투력) */
  extra: number;
  vibe: 'fan' | 'power';
}

/** 이정표 레벨에 오르면 붙는 보너스의 합 (steps를 지나면 repeat.every레벨마다 repeat.value씩) */
export function milestoneBonus(persona: Persona, level: number): number {
  const m = N.milestones[persona];
  let extra = 0;
  for (const step of m.steps) if (level >= step.level) extra += step.value;
  const last = m.steps[m.steps.length - 1].level;
  if (level > last) extra += Math.floor((level - last) / m.repeat.every) * m.repeat.value;
  return extra;
}

/** 다음 이정표 레벨과 그 보너스 */
export function nextMilestone(persona: Persona, level: number): { level: number; value: number } {
  const m = N.milestones[persona];
  const step = m.steps.find((s) => level < s.level);
  if (step) return step;
  const last = m.steps[m.steps.length - 1].level;
  return { level: last + (Math.floor((level - last) / m.repeat.every) + 1) * m.repeat.every, value: m.repeat.value };
}

export function nurtureBonus(persona: Persona, xp: number): NurtureBonus {
  const level = nurtureLevel(xp);
  return { level, rhyme: N.perLevel.rhyme * (level - 1), coin: N.perLevel.coin * (level - 1), extra: milestoneBonus(persona, level), vibe: N.milestones[persona].vibe };
}

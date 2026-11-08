import { ENDLESS, ENDLESS_MAX_TIER, endlessGoal, type EndlessDef } from './balance';
import { achievementValue, clampResource } from './selectors';
import type { GameState } from './types';

/*
 * 끝없는 업적. 일반 업적과 달리 마지막 목표를 넘어서도 목표가 계속 이어진다(balance.ts의 ENDLESS: n단계 목표 = base × growth^(n−1)).
 * 단계에 닿으면 다이아를 자동으로 받는다. 지표는 일반 업적과 같이 상태에서만 계산하니 예전 저장도 처음 불러올 때 닿은 단계가 한꺼번에 열린다.
 */

/** 값 하나로 닿은 단계 수 */
export function endlessReached(def: EndlessDef, value: number): number {
  let n = 0;
  while (n < ENDLESS_MAX_TIER && value >= endlessGoal(def, n + 1)) n++;
  return n;
}

export interface EndlessStatus {
  def: EndlessDef;
  value: number;
  /** 받은 단계 수 */
  tier: number;
  /** 다음 단계 목표 */
  goal: number;
}

export function endlessStatuses(s: GameState): EndlessStatus[] {
  return ENDLESS.map((def) => {
    const tier = Math.min(s.endless[def.id] ?? 0, ENDLESS_MAX_TIER);
    return { def, value: Math.floor(achievementValue(s, def.metric)), tier, goal: endlessGoal(def, tier + 1) };
  });
}

export interface EndlessGain {
  def: EndlessDef;
  /** 새로 받은 단계 수 */
  tiers: number;
  diamonds: number;
}

export interface EndlessResult {
  state: GameState;
  gains: EndlessGain[];
}

/** 새로 닿은 단계를 모두 받고 다이아를 지급한다. 받을 게 없으면 같은 상태를 돌려준다. */
export function evaluateEndless(state: GameState): EndlessResult {
  const gains: EndlessGain[] = [];
  const endless = { ...state.endless };
  let diamonds = state.diamonds;
  for (const def of ENDLESS) {
    const have = Math.min(endless[def.id] ?? 0, ENDLESS_MAX_TIER);
    const reached = endlessReached(def, achievementValue(state, def.metric));
    if (reached <= have) continue;
    endless[def.id] = reached;
    diamonds += (reached - have) * def.diamonds;
    gains.push({ def, tiers: reached - have, diamonds: (reached - have) * def.diamonds });
  }
  if (gains.length === 0) return { state, gains };
  return { state: { ...state, endless, diamonds: clampResource(diamonds) }, gains };
}

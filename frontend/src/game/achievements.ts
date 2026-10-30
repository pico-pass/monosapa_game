import { ACHIEVEMENTS, type AchievementDef } from './balance';
import { ACHIEVEMENT_TEXT } from './content';
import { achievementValue, clampResource } from './selectors';
import type { CommandResult, Fail, GameState } from './types';

/*
 * 업적. 조건은 balance.ts의 ACHIEVEMENTS 표(지표 + 목표값)이고, 달성하면 다이아를 한 번 받는다.
 * 지표는 상태에서만 계산하므로, 업적이 없던 예전 저장도 처음 불러올 때 이미 달성한 것이 한꺼번에 열린다.
 */

export interface AchievementStatus {
  def: AchievementDef;
  value: number;
  done: boolean;
  /** 달성한 시각. 아직이면 null */
  at: number | null;
}

export function achievementStatuses(s: GameState): AchievementStatus[] {
  return ACHIEVEMENTS.map((def) => {
    const value = achievementValue(s, def.metric);
    const at = s.achievements[def.id] ?? null;
    return { def, value: Math.min(value, def.goal), done: at !== null, at };
  });
}

export interface EvaluateResult {
  state: GameState;
  unlocked: AchievementDef[];
}

/** 새로 달성한 업적을 모두 열고 다이아를 지급한다. 달성한 게 없으면 같은 상태를 돌려준다. */
export function evaluateAchievements(state: GameState): EvaluateResult {
  const unlocked = ACHIEVEMENTS.filter((def) => state.achievements[def.id] === undefined && achievementValue(state, def.metric) >= def.goal);
  if (unlocked.length === 0) return { state, unlocked };
  const achievements = { ...state.achievements };
  let diamonds = state.diamonds;
  for (const def of unlocked) {
    achievements[def.id] = state.lastSettledAt;
    diamonds += def.diamonds;
  }
  return { state: { ...state, achievements, diamonds: clampResource(diamonds) }, unlocked };
}

/** 칭호는 달성한 업적 중 칭호가 있는 것만 달 수 있다. null이면 칭호를 뗀다. */
export function setTitle(state: GameState, id: string | null): CommandResult {
  if (id !== null) {
    const ok = state.achievements[id] !== undefined && !!ACHIEVEMENT_TEXT[id]?.title;
    if (!ok) {
      const fail: Fail = { ok: false, reason: 'not_owned', state };
      return fail;
    }
  }
  return { ok: true, state: { ...state, cosmetics: { ...state.cosmetics, title: id } } };
}

/** 달고 있는 칭호의 표시 문구. 없으면 null */
export const titleText = (s: Pick<GameState, 'cosmetics'>): string | null =>
  s.cosmetics.title ? (ACHIEVEMENT_TEXT[s.cosmetics.title]?.title ?? null) : null;

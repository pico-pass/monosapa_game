import { BALANCE, SKILL_IDS } from './balance';
import { playerLevel } from './selectors';
import type { CommandResult, Fail, FailReason, GameState, SkillId, Skills } from './types';

/*
 * 레벨 스킬. 플레이어 레벨 levelsPerPoint마다 포인트 1개를 받아 다섯 갈래에 찍는다(balance.ts의 skills).
 * 쓸 수 있는 포인트 = 지금까지 받은 포인트 − 이미 찍은 단계 합. 받은 포인트는 팬 수에서 계산하니 저장하지 않는다.
 * 효과(영구 보너스)는 packdata.ts의 bonuses가 합산한다. 다이아로 모두 돌려받아 다시 찍을 수 있다.
 */

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export const emptySkills = (): Skills => ({ rhyme: 0, coin: 0, fan: 0, power: 0, offline: 0 });

/** 지금까지 받은 포인트 */
export const skillPointsEarned = (fans: number): number => Math.floor((playerLevel(fans) - 1) / BALANCE.skills.levelsPerPoint);

/** 이미 찍은 단계 합 */
export const skillPointsSpent = (skills: Skills): number => SKILL_IDS.reduce((sum, id) => sum + (skills[id] ?? 0), 0);

/** 지금 찍을 수 있는 포인트 */
export const skillPointsFree = (s: Pick<GameState, 'fans' | 'skills'>): number => Math.max(0, skillPointsEarned(s.fans) - skillPointsSpent(s.skills));

/** 다음 포인트까지 남은 플레이어 레벨 수 */
export function levelsToNextPoint(fans: number): number {
  const step = BALANCE.skills.levelsPerPoint;
  const lv = playerLevel(fans) - 1;
  return step - (lv % step);
}

/** 한 갈래의 단계 하나가 올려 주는 값 (오프라인은 ms, 나머지는 비율) */
export const skillPerLevel = (id: SkillId): number => (id === 'offline' ? BALANCE.skills.offlinePerLevelMs : BALANCE.skills.perLevel);

/** 포인트 1개를 그 갈래에 찍는다. 포인트가 없으면 no_points, 갈래가 가득이면 max_level. */
export function buySkill(state: GameState, id: SkillId): CommandResult<{ level: number }> {
  if (!SKILL_IDS.includes(id)) return fail(state, 'not_found');
  const level = state.skills[id] ?? 0;
  if (level >= BALANCE.skills.maxLevel) return fail(state, 'max_level');
  if (skillPointsFree(state) < 1) return fail(state, 'no_points');
  return { ok: true, state: { ...state, skills: { ...state.skills, [id]: level + 1 } }, level: level + 1 };
}

/** 다이아를 내고 찍은 포인트를 모두 돌려받는다. 찍은 게 없으면 nothing_to_skip. */
export function respecSkills(state: GameState): CommandResult<{ cost: number; points: number }> {
  const points = skillPointsSpent(state.skills);
  if (points <= 0) return fail(state, 'nothing_to_skip');
  const cost = BALANCE.skills.respecCost;
  if (state.diamonds < cost) return fail(state, 'insufficient_diamonds');
  return { ok: true, state: { ...state, diamonds: state.diamonds - cost, skills: emptySkills() }, cost, points };
}

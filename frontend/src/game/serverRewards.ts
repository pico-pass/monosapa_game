import { NOTE_LIMIT } from './pack-state';
import { clampResource } from './selectors';
import { track } from './tracking';
import type { CommandResult, GameState } from './types';

/*
 * 서버(챌린지·차트)가 계산해서 돌려준 보상을 게임 저장에 반영한다. 서버는 한 번만 계산해 주고 "받은 것"으로 표시하므로,
 * 클라이언트는 받은 값을 바로 반영한다. 게임 규칙을 서버가 검증하지 않는 기존 방식과 같다.
 * 비정상적으로 큰 값은 상한으로 잘라서 반영한다.
 */

const MAX_DIAMONDS = 50;

const cap = (n: number): number => Math.max(0, Math.min(MAX_DIAMONDS, Math.floor(Number.isFinite(n) ? n : 0)));

/** 챌린지에 한 줄을 올렸다 (카운터만 오른다) */
export const applyChallengePosted = (state: GameState): CommandResult => ({ ok: true, state: track(state, 'challenges') });

/** 지난주 챌린지 결과 보상. 3위 안에 든 글은 가사 노트에 남긴다. */
export function applyChallengeClaim(state: GameState, diamonds: number, rank: number, text: string): CommandResult<{ diamonds: number; noted: boolean }> {
  const d = cap(diamonds);
  const noted = rank >= 1 && rank <= 3 && text.length > 0 && text.length <= 120 && !state.stats.notes.includes(text);
  const notes = noted ? [...state.stats.notes, text].slice(-NOTE_LIMIT) : state.stats.notes;
  return { ok: true, state: { ...state, diamonds: clampResource(state.diamonds + d), stats: { ...state.stats, notes } }, diamonds: d, noted };
}

/** 우편함에서 받은 다이아(친구 선물·운영 우편). 서버가 우편마다 한 번만 내주고, 한꺼번에 받을 수도 있어 상한이 넉넉하다. */
const MAX_MAIL_DIAMONDS = 100_000;

export function applyMailClaim(state: GameState, diamonds: number): CommandResult<{ diamonds: number }> {
  const d = Math.max(0, Math.min(MAX_MAIL_DIAMONDS, Math.floor(Number.isFinite(diamonds) ? diamonds : 0)));
  return { ok: true, state: { ...state, diamonds: clampResource(state.diamonds + d) }, diamonds: d };
}

/** 음원 차트 순위 보상 */
export function applyChartClaim(state: GameState, diamonds: number, no1: boolean): CommandResult<{ diamonds: number }> {
  const d = cap(diamonds);
  let next = track({ ...state, diamonds: clampResource(state.diamonds + d) }, 'chartTop10');
  if (no1) next = track(next, 'chartNo1');
  return { ok: true, state: next, diamonds: d };
}

/** 마을 깃발로 받는 ❤️(내가 꽂은 것과 친구가 꽂아 준 것). 서버가 하루 한 번만 내주고 값도 서버가 정한다. */
const MAX_FLAG_HEARTS = 2000;

export function applyVillageHearts(state: GameState, hearts: number): CommandResult<{ hearts: number }> {
  const h = Math.max(0, Math.min(MAX_FLAG_HEARTS, Math.floor(Number.isFinite(hearts) ? hearts : 0)));
  return { ok: true, state: { ...state, village: { ...state.village, hearts: state.village.hearts + h } }, hearts: h };
}

/** 월드 보스 단계·순위 보상 */
export function applyBossClaim(state: GameState, diamonds: number): CommandResult<{ diamonds: number }> {
  const d = cap(diamonds);
  return { ok: true, state: { ...state, diamonds: clampResource(state.diamonds + d) }, diamonds: d };
}

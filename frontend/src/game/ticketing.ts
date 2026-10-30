import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import type { GameState } from './types';

/*
 * 피켓팅: 대기하다가 오픈 신호에 누르는 반응속도 + 보안문자 입력. 모든 시간은 미니게임 시계(ms)로만 잰다.
 * 점수가 매진 기준 이상이면 다음 공연 코인에 배율이 붙는다(arcade.finishArcade가 boost를 저장하고, 공연 보상에서 applyTicketBoost가 쓴다).
 */

const T = BALANCE.ticketing;

export interface TicketGame {
  code: string;
  /** 반응 시간에서 깎아 주는 비율(전투력 보너스, 최대 30%) */
  grace: number;
  /** 오픈 시각(시작 후 ms) */
  openAtMs: number;
  elapsedMs: number;
  phase: 'wait' | 'open' | 'captcha' | 'done';
  /** 오픈 신호 뒤 누르기까지 걸린 시간. 오픈 전에 눌렀으면 null */
  reactionMs: number | null;
  falseStart: boolean;
  captchaStartMs: number | null;
  captchaMs: number | null;
  captchaOk: boolean | null;
}

export function createTicketing(seed: number, power = 0): TicketGame {
  const rng = mulberry32(seed);
  rng();
  const [lo, hi] = T.waitMs;
  const code = Array.from({ length: T.captchaDigits }, () => Math.floor(rng() * 10)).join('');
  return {
    code,
    grace: Math.min(0.3, Math.max(0, power)),
    openAtMs: Math.round(lo + rng() * (hi - lo)),
    elapsedMs: 0,
    phase: 'wait',
    reactionMs: null,
    falseStart: false,
    captchaStartMs: null,
    captchaMs: null,
    captchaOk: null,
  };
}

/** 시계를 tMs까지 진행: 오픈 시각이 되면 열리고, 보안문자 제한 시간이 지나면 실패로 끝난다. */
export function tickTicketing(g: TicketGame, tMs: number): TicketGame {
  if (!(tMs > g.elapsedMs) || g.phase === 'done') return g;
  let next: TicketGame = { ...g, elapsedMs: tMs };
  if (next.phase === 'wait' && tMs >= next.openAtMs) next = { ...next, phase: 'open' };
  if (next.phase === 'captcha' && next.captchaStartMs !== null && tMs - next.captchaStartMs > T.captchaMs) {
    next = { ...next, phase: 'done', captchaOk: false, captchaMs: T.captchaMs };
  }
  return next;
}

/** 예매 버튼을 누른다. 오픈 전이면 부정 출발(반응 점수 0)이다. */
export function pressTicket(g: TicketGame, tMs: number): TicketGame {
  const t = tickTicketing(g, tMs);
  if (t.phase === 'wait') return { ...t, elapsedMs: Math.max(t.elapsedMs, tMs), phase: 'captcha', falseStart: true, reactionMs: null, captchaStartMs: tMs };
  if (t.phase === 'open') return { ...t, phase: 'captcha', reactionMs: Math.max(0, tMs - t.openAtMs), captchaStartMs: tMs };
  return t;
}

/** 보안문자를 제출한다. */
export function submitCode(g: TicketGame, tMs: number, text: string): TicketGame {
  const t = tickTicketing(g, tMs);
  if (t.phase !== 'captcha' || t.captchaStartMs === null) return t;
  const took = Math.max(0, tMs - t.captchaStartMs);
  return { ...t, phase: 'done', captchaMs: took, captchaOk: text.trim() === t.code };
}

export const isTicketDone = (g: TicketGame): boolean => g.phase === 'done';

export function reactionScore(g: TicketGame): number {
  if (g.reactionMs === null) return 0;
  const ms = g.reactionMs * (1 - g.grace);
  const x = (T.reactionWorstMs - ms) / (T.reactionWorstMs - T.reactionBestMs);
  return Math.round(T.reactionMax * Math.max(0, Math.min(1, x)));
}

export function captchaScore(g: TicketGame): number {
  if (!g.captchaOk || g.captchaMs === null) return 0;
  return Math.round(T.captchaBase + T.captchaSpeed * Math.max(0, 1 - g.captchaMs / T.captchaMs));
}

export const scoreOf = (g: TicketGame): number => Math.min(1000, reactionScore(g) + captchaScore(g));

/** 다음 공연 코인에 곱한다. 배율이 켜져 있으면 쓰고 지운다. (코인은 내림) */
export function applyTicketBoost(state: GameState, coins: number): { state: GameState; coins: number; boosted: boolean } {
  const b = state.arcade.ticketing.boost;
  if (!b) return { state, coins, boosted: false };
  const next = { ...state, arcade: { ...state.arcade, ticketing: { ...state.arcade.ticketing, boost: null } } };
  if (b.until <= state.lastSettledAt) return { state: next, coins, boosted: false };
  return { state: next, coins: Math.floor(coins * b.mult), boosted: true };
}

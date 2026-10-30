import { BALANCE } from './balance';
import { mascotBonus, mascotMood, mascotStage, type Mood } from './packdata';
import { mulberry32 } from './runner';
import { clampResource, royaltyBreakdown } from './selectors';
import { mix } from './streaming';
import { track } from './tracking';
import type { CommandResult, Fail, FailReason, GameState, Mascot, Persona } from './types';

/* 마스코트: 자아마다 하나. 간식을 주고 놀아 주면 자라고, 방치하면 배고파하다 삐진다. 단계가 오르면 그 자아의 라임 생산이 늘어난다. */

const M = BALANCE.mascot;
const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export const feedCost = (level: number): number => Math.ceil(M.feed.baseCoins * M.feed.growth ** Math.max(0, level - 1));

export interface MascotView {
  persona: Persona;
  mascot: Mascot;
  stage: number;
  mood: Mood;
  /** 다음 단계까지 필요한 xp(마지막 단계면 null) */
  nextXp: number | null;
  /** 지금 적용되는 생산 보너스(기분 반영) */
  bonus: number;
  playWaitMs: number;
  giftWaitMs: number;
  /** 선물을 받을 수 있다(배부르고 시간이 됨) */
  giftReady: boolean;
}

export function mascotView(s: Pick<GameState, 'mascot' | 'lastSettledAt'>, persona: Persona): MascotView {
  const m = s.mascot[persona];
  const at = s.lastSettledAt;
  const stage = mascotStage(m.xp);
  const mood = mascotMood(m, at);
  const giftWaitMs = Math.max(0, m.giftReadyAt - at);
  return {
    persona,
    mascot: m,
    stage,
    mood,
    nextXp: M.stageXp[stage + 1] ?? null,
    bonus: mascotBonus(m, at),
    playWaitMs: Math.max(0, m.playReadyAt - at),
    giftWaitMs,
    giftReady: mood === 'happy' && giftWaitMs === 0,
  };
}

const withMascot = (s: GameState, persona: Persona, patch: Partial<Mascot>): GameState => ({ ...s, mascot: { ...s.mascot, [persona]: { ...s.mascot[persona], ...patch } } });

/** 간식 주기 (코인). 배부름 시간이 늘고 xp가 오른다. */
export function feedMascot(state: GameState, persona: Persona, level: number): CommandResult<{ cost: number }> {
  const cost = feedCost(level);
  if (state.coins < cost) return fail(state, 'insufficient_coins');
  const m = state.mascot[persona];
  const now = state.lastSettledAt;
  const fullUntil = Math.min(Math.max(m.fullUntil, now) + M.fullMs, now + M.fullCapMs);
  const next = track(withMascot({ ...state, coins: state.coins - cost }, persona, { fullUntil, xp: m.xp + M.feed.xp }), 'pets');
  return { ok: true, state: next, cost };
}

/** 놀아 주기 (무료, 쿨다운) */
export function playMascot(state: GameState, persona: Persona): CommandResult {
  const m = state.mascot[persona];
  if (m.playReadyAt > state.lastSettledAt) return fail(state, 'cooldown');
  return { ok: true, state: track(withMascot(state, persona, { playReadyAt: state.lastSettledAt + M.play.cooldownMs, xp: m.xp + M.play.xp }), 'pets') };
}

/** 선물하기 (다이아): xp를 크게 올린다. */
export function giftMascot(state: GameState, persona: Persona): CommandResult<{ cost: number }> {
  const cost = M.gift.diamonds;
  if (state.diamonds < cost) return fail(state, 'insufficient_diamonds');
  const m = state.mascot[persona];
  return { ok: true, state: track(withMascot({ ...state, diamonds: state.diamonds - cost }, persona, { xp: m.xp + M.gift.xp }), 'pets'), cost };
}

/** 배부른 마스코트가 가져온 선물 받기 (코인, 가끔 다이아) */
export function claimPresent(state: GameState, persona: Persona): CommandResult<{ coins: number; diamonds: number }> {
  const v = mascotView(state, persona);
  if (v.mood !== 'happy' || v.giftWaitMs > 0) return fail(state, 'not_ready');
  const coins = Math.max(M.present.minCoins, Math.ceil(royaltyBreakdown(state, persona).perSec * M.present.coinSecs));
  const rng = mulberry32(mix(state.feat.seed ^ (persona === 'normal' ? 0x6d61 : 0x6d62), v.mascot.giftReadyAt));
  rng();
  const diamonds = rng() < M.present.diamondChance ? 1 : 0;
  const next = withMascot(
    { ...state, coins: clampResource(state.coins + coins), diamonds: clampResource(state.diamonds + diamonds) },
    persona,
    { giftReadyAt: state.lastSettledAt + M.present.intervalMs },
  );
  return { ok: true, state: next, coins, diamonds };
}

/** 받을 수 있는 선물 수 (알림용) */
export const presentsReady = (s: Pick<GameState, 'mascot' | 'lastSettledAt'>): number =>
  (['normal', 'dark'] as const).filter((p) => mascotView(s, p).giftReady && mascotStage(s.mascot[p].xp) >= 1).length;

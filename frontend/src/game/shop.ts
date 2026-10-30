import { BALANCE } from './balance';
import { shopPrice } from './selectors';
import { track } from './tracking';
import type { CampaignId, CommandResult, Fail, FailReason, GameState, SnackId, ThemeId } from './types';

/*
 * 상점 명령. 다른 명령과 같이 이미 now까지 정산된 상태(state.lastSettledAt이 now)를 받는다.
 * 간식·홍보 캠페인은 코인, 테마는 다이아로 산다.
 */

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export const snackPrice = (s: Pick<GameState, 'fans'>, id: SnackId): number => shopPrice(BALANCE.shop.snacks[id].base, s.fans);
export const campaignPrice = (s: Pick<GameState, 'fans'>, id: CampaignId): number => shopPrice(BALANCE.shop.campaigns[id].base, s.fans);

/** 버프를 사면 끝나는 시각. 같은 버프가 켜져 있으면 시간이 더해지고(최대 maxStack배), 다르면 새로 시작한다. */
function nextUntil(now: number, current: { id: string; until: number } | null, id: string, durationMs: number): { until: number; extended: boolean } | null {
  const active = current !== null && current.until > now;
  if (active && current.id === id) {
    const until = Math.min(current.until + durationMs, now + durationMs * BALANCE.shop.maxStack);
    return until > current.until ? { until, extended: true } : null; // 더 쌓을 수 없다
  }
  return { until: now + durationMs, extended: false };
}

export function buySnack(state: GameState, id: SnackId): CommandResult<{ cost: number; extended: boolean }> {
  const def = BALANCE.shop.snacks[id];
  if (!def) return fail(state, 'not_found');
  const cost = snackPrice(state, id);
  if (state.coins < cost) return fail(state, 'insufficient_coins');
  const n = nextUntil(state.lastSettledAt, state.buffs.snack, id, def.durationMs);
  if (!n) return fail(state, 'already_done');
  const next = track({ ...state, coins: state.coins - cost, buffs: { ...state.buffs, snack: { id, until: n.until } } }, 'snacks');
  return { ok: true, state: next, cost, extended: n.extended };
}

export function buyCampaign(state: GameState, id: CampaignId): CommandResult<{ cost: number; extended: boolean }> {
  const def = BALANCE.shop.campaigns[id];
  if (!def) return fail(state, 'not_found');
  const cost = campaignPrice(state, id);
  if (state.coins < cost) return fail(state, 'insufficient_coins');
  const n = nextUntil(state.lastSettledAt, state.buffs.campaign, id, def.durationMs);
  if (!n) return fail(state, 'already_done');
  const next = track({ ...state, coins: state.coins - cost, buffs: { ...state.buffs, campaign: { id, until: n.until } } }, 'campaigns');
  return { ok: true, state: next, cost, extended: n.extended };
}

/** 테마를 다이아로 사고 바로 적용한다. */
export function buyTheme(state: GameState, id: ThemeId): CommandResult<{ cost: number }> {
  const cost = BALANCE.shop.themes[id];
  if (cost === undefined) return fail(state, 'not_found');
  if (state.cosmetics.themes.includes(id)) return fail(state, 'owned');
  if (state.diamonds < cost) return fail(state, 'insufficient_diamonds');
  const next: GameState = {
    ...state,
    diamonds: state.diamonds - cost,
    cosmetics: { ...state.cosmetics, themes: [...state.cosmetics.themes, id], theme: id },
  };
  return { ok: true, state: next, cost };
}

export function setTheme(state: GameState, id: ThemeId): CommandResult {
  if (!state.cosmetics.themes.includes(id)) return fail(state, 'not_owned');
  return { ok: true, state: { ...state, cosmetics: { ...state.cosmetics, theme: id } } };
}

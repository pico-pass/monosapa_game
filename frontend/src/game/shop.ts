import { BALANCE, SNACK_IDS, costumePersona } from './balance';
import { royaltyBreakdown, shopPrice } from './selectors';
import { mix } from './streaming';
import { track } from './tracking';
import type { CampaignId, CommandResult, Cosmetics, CostumeId, Fail, FailReason, GameState, ItemId, Persona, SnackId, ThemeId } from './types';

/*
 * 상점 명령. 다른 명령과 같이 이미 now까지 정산된 상태(state.lastSettledAt이 now)를 받는다.
 * 간식·편의점 상품·야식·홍보 캠페인은 코인, 테마·코스튬은 다이아로 산다.
 * 편의점(간식·상품·야식)에서 살 때마다 멤버십 스탬프가 하나 쌓이고, 목표를 채우면 무료 간식 쿠폰이 뽑힌다.
 */

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export const snackPrice = (s: Pick<GameState, 'fans'>, id: SnackId): number => shopPrice(BALANCE.shop.snacks[id].base, s.fans);
/** 인세에 묶인 가격: 기본 가격(shopPrice)과 인세 secs초 분량 중 큰 쪽. 두 자아 중 인세가 높은 쪽으로 센다(자아를 바꿔 싸게 사지 못하게). */
function incomePrice(s: GameState, base: number, secs: number): number {
  const perSec = Math.max(royaltyBreakdown(s, 'normal').perSec, royaltyBreakdown(s, 'dark').perSec);
  return Math.max(shopPrice(base, s.fans), Math.ceil(perSec * secs));
}

export function itemPrice(s: GameState, id: ItemId): number {
  const def = BALANCE.shop.items[id];
  return def.incomeSecs ? incomePrice(s, def.base, def.incomeSecs) : shopPrice(def.base, s.fans);
}
export const mealPrice = (s: GameState): number => incomePrice(s, BALANCE.shop.meal.base, BALANCE.shop.meal.incomeSecs);
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

/**
 * 편의점에서 하나 샀다: 스탬프를 하나 더하고, 목표를 채우면 무료 간식 쿠폰을 뽑는다(스탬프는 0으로).
 * 쿠폰을 아직 쓰지 않았으면 스탬프는 목표에서 멈춰 있다가 쿠폰을 쓸 때 이어서 쿠폰이 된다.
 * 어떤 간식인지는 씨앗과 구매 횟수로만 정해서 같은 저장은 같은 쿠폰을 뽑는다.
 */
export function stampMart(state: GameState): GameState {
  const goal = BALANCE.shop.stamps.goal;
  let { stamps, coupon } = state.mart;
  stamps = Math.min(goal, stamps + 1);
  if (stamps >= goal && coupon === null) {
    coupon = SNACK_IDS[mix(state.feat.seed ^ 0x636f7570, state.counters.snacks) % SNACK_IDS.length];
    stamps = 0;
  }
  return { ...state, mart: { ...state.mart, stamps, coupon } };
}

export function buySnack(state: GameState, id: SnackId): CommandResult<{ cost: number; extended: boolean }> {
  const def = BALANCE.shop.snacks[id];
  if (!def) return fail(state, 'not_found');
  const cost = snackPrice(state, id);
  if (state.coins < cost) return fail(state, 'insufficient_coins');
  const n = nextUntil(state.lastSettledAt, state.buffs.snack, id, def.durationMs);
  if (!n) return fail(state, 'already_done');
  const bought = track({ ...state, coins: state.coins - cost, buffs: { ...state.buffs, snack: { id, until: n.until } } }, 'snacks');
  return { ok: true, state: stampMart(bought), cost, extended: n.extended };
}

/** 편의점 상품(어묵·얼음컵·초코바·딸기우유)을 사서 켠다. 같은 상품이면 시간이 더해지고 다른 상품이면 바뀐다. */
export function buyItem(state: GameState, id: ItemId): CommandResult<{ cost: number; extended: boolean }> {
  const def = BALANCE.shop.items[id];
  if (!def) return fail(state, 'not_found');
  const cost = itemPrice(state, id);
  if (state.coins < cost) return fail(state, 'insufficient_coins');
  const n = nextUntil(state.lastSettledAt, state.buffs.item, id, def.durationMs);
  if (!n) return fail(state, 'already_done');
  const bought = track({ ...state, coins: state.coins - cost, buffs: { ...state.buffs, item: { id, until: n.until } } }, 'snacks');
  return { ok: true, state: stampMart(bought), cost, extended: n.extended };
}

/** 야식 컵라면 세트를 산다. 최대 meal.max개까지 가진다. */
export function buyMeal(state: GameState): CommandResult<{ cost: number }> {
  if (state.mart.nightMeals >= BALANCE.shop.meal.max) return fail(state, 'already_done');
  const cost = mealPrice(state);
  if (state.coins < cost) return fail(state, 'insufficient_coins');
  const bought = track({ ...state, coins: state.coins - cost, mart: { ...state.mart, nightMeals: state.mart.nightMeals + 1 } }, 'snacks');
  return { ok: true, state: stampMart(bought), cost };
}

/**
 * 무료 간식 쿠폰을 쓴다: 뽑힌 간식을 돈 없이 켠다(같은 간식이면 시간이 더해지고 최대 maxStack배, 다른 간식이면 바뀐다).
 * 더 쌓을 수 없으면 쿠폰은 그대로 남는다. 간식 구매 횟수·스탬프에는 세지 않는다. 스탬프가 이미 가득이면 새 쿠폰이 이어서 뽑힌다.
 */
export function redeemCoupon(state: GameState): CommandResult<{ snack: SnackId; extended: boolean }> {
  const id = state.mart.coupon;
  if (id === null) return fail(state, 'not_ready');
  const n = nextUntil(state.lastSettledAt, state.buffs.snack, id, BALANCE.shop.snacks[id].durationMs);
  if (!n) return fail(state, 'already_done');
  const used: GameState = { ...state, buffs: { ...state.buffs, snack: { id, until: n.until } }, mart: { ...state.mart, coupon: null } };
  // 스탬프가 이미 가득 차 있었다면 지금 새 쿠폰을 뽑는다
  const next = state.mart.stamps >= BALANCE.shop.stamps.goal ? stampMart({ ...used, mart: { ...used.mart, stamps: BALANCE.shop.stamps.goal - 1 } }) : used;
  return { ok: true, state: next, snack: id, extended: n.extended };
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

/** 그 자아의 입은 옷 칸을 바꾼다. 자아가 맞는 코스튬만 들어온다고 가정한다. */
function wear(c: Cosmetics, persona: Persona, id: CostumeId | null): Cosmetics {
  return persona === 'normal' ? { ...c, costume: id as Cosmetics['costume'] } : { ...c, darkCostume: id as Cosmetics['darkCostume'] };
}

/** 코스튬(일반 50·어둠 66다이아)을 사고 바로 그 자아가 입는다. */
export function buyCostume(state: GameState, id: CostumeId): CommandResult<{ cost: number }> {
  const cost = BALANCE.shop.costumes[id];
  if (cost === undefined) return fail(state, 'not_found');
  if (state.cosmetics.costumes.includes(id)) return fail(state, 'owned');
  if (state.diamonds < cost) return fail(state, 'insufficient_diamonds');
  const cosmetics = wear({ ...state.cosmetics, costumes: [...state.cosmetics.costumes, id] }, costumePersona(id), id);
  return { ok: true, state: { ...state, diamonds: state.diamonds - cost, cosmetics }, cost };
}

/** 그 자아에게 코스튬을 입힌다. null이면 기본 옷으로 돌아간다. 다른 자아의 옷은 입힐 수 없다. */
export function setCostume(state: GameState, persona: Persona, id: CostumeId | null): CommandResult {
  if (id !== null) {
    if (!state.cosmetics.costumes.includes(id)) return fail(state, 'not_owned');
    if (costumePersona(id) !== persona) return fail(state, 'not_found');
  }
  return { ok: true, state: { ...state, cosmetics: wear(state.cosmetics, persona, id) } };
}

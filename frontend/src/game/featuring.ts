import { BALANCE, FEAT_NPCS, featDefById, type FeatDef } from './balance';
import { pickupOf } from './packdata';
import { mulberry32 } from './runner';
import { clampResource } from './selectors';
import { mix } from './streaming';
import { track } from './tracking';
import type { CommandResult, Fail, FailReason, GameState } from './types';

/*
 * 피처링 가챠: NPC 래퍼 카드를 다이아로 뽑는다. SSR은 이번 주 픽업이 50%, 빗나가면 다음 SSR은 픽업 확정, 50회 천장.
 * 결과는 씨앗과 뽑기 번호로만 정해진다.
 */

const F = BALANCE.feat;
const PULL_SALT = 0x66656174;

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export interface FeatPullResult {
  id: string;
  rarity: FeatDef['rarity'];
  isNew: boolean;
  /** 별이 올랐다(중복) */
  starUp: boolean;
  /** 별이 가득 차서 다이아로 환급됐다 */
  refund: number;
  pickup: boolean;
}

const byRarity = (r: FeatDef['rarity']): FeatDef[] => FEAT_NPCS.filter((n) => n.rarity === r);

/** 뽑기 한 번의 결과(상태는 건드리지 않는다). tenLast: 10연의 마지막이면서 아직 SR 이상이 없었다. */
export function rollFeat(
  seed: number,
  seq: number,
  pity: number,
  guaranteed: boolean,
  pickup: FeatDef,
  tenLast: boolean,
): { def: FeatDef; pickup: boolean } {
  const rng = mulberry32(mix(seed ^ PULL_SALT, seq));
  rng();
  const r = rng();
  const r2 = rng();
  const r3 = rng();
  const pick = (list: FeatDef[]) => list[Math.floor(r3 * list.length) % list.length];
  if (pity + 1 >= F.pityAt || r < F.rates.SSR) {
    const ssr = byRarity('SSR');
    const others = ssr.filter((n) => n.id !== pickup.id);
    const isPickup = guaranteed || r2 < F.pickupRate || others.length === 0;
    return { def: isPickup ? pickup : pick(others), pickup: isPickup };
  }
  if (tenLast || r < F.rates.SSR + F.rates.SR) return { def: pick(byRarity('SR')), pickup: false };
  return { def: pick(byRarity('R')), pickup: false };
}

export function featPull(state: GameState, count: 1 | 10 = 1): CommandResult<{ results: FeatPullResult[]; cost: number; refund: number }> {
  const cost = count === 10 ? F.tenCost : F.pullCost;
  if (state.diamonds < cost) return fail(state, 'insufficient_diamonds');
  const pickup = pickupOf(state.lastSettledAt);
  const owned = { ...state.feat.owned };
  let { pity, guaranteed, pulls } = state.feat;
  let refundTotal = 0;
  let hasSr = false;
  const results: FeatPullResult[] = [];
  for (let i = 0; i < count; i++) {
    pulls += 1;
    const roll = rollFeat(state.feat.seed, pulls, pity, guaranteed, pickup, count === 10 && i === count - 1 && !hasSr);
    const def = roll.def;
    if (def.rarity === 'SSR') {
      pity = 0;
      guaranteed = !roll.pickup;
    } else pity += 1;
    if (def.rarity !== 'R') hasSr = true;
    const stars = owned[def.id] ?? 0;
    let refund = 0;
    if (stars >= F.maxStar) refund = F.dupRefund[def.rarity];
    else owned[def.id] = stars + 1;
    refundTotal += refund;
    results.push({ id: def.id, rarity: def.rarity, isNew: stars === 0, starUp: stars > 0 && refund === 0, refund, pickup: roll.pickup });
  }
  const next = track(
    {
      ...state,
      diamonds: clampResource(state.diamonds - cost + refundTotal),
      feat: { ...state.feat, owned, pity, guaranteed, pulls },
    },
    'pulls',
    count,
  );
  return { ok: true, state: next, results, cost, refund: refundTotal };
}

/** 장착을 켜고 끈다. */
export function toggleFeat(state: GameState, id: string): CommandResult<{ equipped: boolean }> {
  if (!featDefById(id)) return fail(state, 'not_found');
  if ((state.feat.owned[id] ?? 0) < 1) return fail(state, 'not_owned');
  const on = state.feat.slots.includes(id);
  if (!on && state.feat.slots.length >= F.slots) return fail(state, 'full_slots');
  const slots = on ? state.feat.slots.filter((x) => x !== id) : [...state.feat.slots, id];
  return { ok: true, state: { ...state, feat: { ...state.feat, slots } }, equipped: !on };
}

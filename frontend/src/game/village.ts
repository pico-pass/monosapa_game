import { BALANCE, BUILDING_IDS } from './balance';
import { weekKey } from './missions';
import { clampResource } from './selectors';
import { mix } from './streaming';
import type { BuildingId, CommandResult, Fail, FailReason, GameState, Village, VillageNews, VillageTile } from './types';
import { buildingMax, countOf, heartCost, heartsSpent, inWindow, stockAt, stockCap, totalLevels, villageEffects, villageSide, villageUnlocked } from './villagedata';

/*
 * 팬 마을 명령. 모두 commands.ts와 같은 규칙이다: 이미 정산된 상태를 받아 조건을 다시 검사하고 단일 상태 변경으로 돌려준다.
 * 시간은 state.lastSettledAt(실제 경과 시간)이다. ❤️는 건물을 바꾸는 명령 때마다 그 직전 시각까지 정산하고 다시 기록한다.
 * 땅·비용·효과 계산은 villagedata.ts, 영구 보너스 합산은 packdata.ts의 bonuses가 한다.
 */

const V = BALANCE.village;
const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });
const validIdx = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < 64;

/* ---------- 소식 카드 ---------- */

/** 시간 구간 b의 소식 카드. 씨앗과 구간 번호로만 정한다. */
export const newsFor = (seed: number, bucket: number): VillageNews => ({
  bucket,
  resident: mix(seed, bucket) % V.news.residents,
  kind: mix(seed ^ 0x6b696e64, bucket) % V.news.kinds,
});

/** 시간 구간이 바뀌었으면 새 카드를 더한다(최대 keep장 보관). 처음에는 지금 구간의 한 장만 나온다. */
export function refreshNews(v: Village, now: number): Village {
  const bucket = Math.floor(now / V.news.bucketMs);
  if (bucket <= v.newsBucket) return v;
  const from = v.newsBucket === 0 ? bucket : Math.max(v.newsBucket + 1, bucket - V.news.keep + 1);
  const fresh: VillageNews[] = [];
  for (let b = from; b <= bucket; b++) fresh.push(newsFor(v.seed, b));
  return { ...v, news: [...v.news, ...fresh].slice(-V.news.keep), newsBucket: bucket };
}

/** 시각 now의 마을(❤️ 정산과 소식 갱신을 반영). 저장하지 않으니 화면·알림이 읽을 때 쓴다. */
export function settleVillage(v: Village, now: number): Village {
  const next = refreshNews(v, now);
  return { ...next, stock: stockAt(v, now), at: Math.max(v.at, now) };
}

/** 지금 화면에 보여 줄 마을 */
export const villageView = (s: Pick<GameState, 'village' | 'lastSettledAt'>): Village => settleVillage(s.village, s.lastSettledAt);

/* ---------- 도우미 ---------- */

/** 열려 있으면 정산한 마을, 아니면 실패 */
function open(state: GameState): Village | Fail {
  if (!villageUnlocked(state.fans)) return fail(state, 'village_locked');
  return settleVillage(state.village, state.lastSettledAt);
}
const isFail = (x: Village | Fail): x is Fail => 'ok' in x;

/** 건물 레벨 합계가 every의 배수에 닿으면 다이아(평생 한 번씩) */
function milestone(tiles: (VillageTile | null)[], paidSteps: number): { paidSteps: number; diamonds: number } {
  const steps = Math.floor(totalLevels({ tiles }) / V.levelDiamonds.every);
  return { paidSteps: Math.max(paidSteps, steps), diamonds: Math.max(0, steps - paidSteps) * V.levelDiamonds.amount };
}

/** 건물이 바뀐 뒤: 새 저장 한도를 넘는 ❤️는 잃지 않고 바로 ❤️ 잔고로 옮긴다. */
function commit(state: GameState, v: Village, tiles: (VillageTile | null)[], heartsDelta: number, diamonds = 0): GameState {
  const cap = stockCap({ tiles });
  const excess = Math.max(0, v.stock - cap);
  const m = milestone(tiles, v.paidSteps);
  const village: Village = { ...v, tiles, hearts: Math.max(0, v.hearts + heartsDelta + Math.floor(excess)), stock: Math.min(v.stock, cap), paidSteps: m.paidSteps };
  return { ...state, village, diamonds: clampResource(state.diamonds + diamonds + m.diamonds) };
}

/* ---------- 건물 ---------- */

export function buildTile(state: GameState, idx: number, b: BuildingId): CommandResult<{ cost: number; diamonds: number }> {
  if (!BUILDING_IDS.includes(b)) return fail(state, 'not_found');
  const v = open(state);
  if (isFail(v)) return v;
  if (!inWindow(idx, villageSide(state.fans))) return fail(state, 'tile_invalid');
  if (v.tiles[idx]) return fail(state, 'tile_taken');
  if (countOf(v, b) >= buildingMax(b)) return fail(state, 'building_limit');
  const cost = heartCost(b, 1);
  if (v.hearts < cost) return fail(state, 'insufficient_hearts');
  const tiles = [...v.tiles];
  tiles[idx] = { b, lv: 1 };
  const next = commit(state, v, tiles, -cost);
  return { ok: true, state: next, cost, diamonds: next.diamonds - state.diamonds };
}

export function upgradeTile(state: GameState, idx: number): CommandResult<{ cost: number; level: number; diamonds: number }> {
  const v = open(state);
  if (isFail(v)) return v;
  const t = validIdx(idx) ? v.tiles[idx] : null;
  if (!t) return fail(state, 'not_found');
  if (t.lv >= V.maxLevel) return fail(state, 'max_level');
  const cost = heartCost(t.b, t.lv + 1);
  if (v.hearts < cost) return fail(state, 'insufficient_hearts');
  const tiles = [...v.tiles];
  tiles[idx] = { b: t.b, lv: t.lv + 1 };
  const next = commit(state, v, tiles, -cost);
  return { ok: true, state: next, cost, level: t.lv + 1, diamonds: next.diamonds - state.diamonds };
}

/** 철거: 쓴 ❤️의 refundRate를 돌려받는다. */
export function demolishTile(state: GameState, idx: number): CommandResult<{ refund: number }> {
  const v = open(state);
  if (isFail(v)) return v;
  const t = validIdx(idx) ? v.tiles[idx] : null;
  if (!t) return fail(state, 'not_found');
  const refund = Math.floor(heartsSpent(t.b, t.lv) * V.refundRate);
  const tiles = [...v.tiles];
  tiles[idx] = null;
  return { ok: true, state: commit(state, v, tiles, refund), refund };
}

/** 이사: 건물을 빈 칸으로 옮긴다. 이웃이 바뀌어 효과가 달라진다. */
export function moveTile(state: GameState, from: number, to: number): CommandResult<{ cost: number }> {
  const v = open(state);
  if (isFail(v)) return v;
  const t = validIdx(from) ? v.tiles[from] : null;
  if (!t) return fail(state, 'not_found');
  if (!inWindow(to, villageSide(state.fans))) return fail(state, 'tile_invalid');
  if (v.tiles[to]) return fail(state, 'tile_taken');
  if (v.hearts < V.moveCost) return fail(state, 'insufficient_hearts');
  const tiles = [...v.tiles];
  tiles[to] = t;
  tiles[from] = null;
  return { ok: true, state: commit(state, v, tiles, -V.moveCost), cost: V.moveCost };
}

/* ---------- 수확·소식·축제 ---------- */

/** 쌓인 ❤️를 모두 받는다. 정수 부분만 받고 소수는 계속 쌓인다. */
export function harvestVillage(state: GameState): CommandResult<{ hearts: number }> {
  const v = open(state);
  if (isFail(v)) return v;
  const hearts = Math.floor(v.stock);
  if (hearts < 1) return fail(state, 'nothing_to_claim');
  return { ok: true, state: { ...state, village: { ...v, hearts: v.hearts + hearts, stock: v.stock - hearts } }, hearts };
}

export type NewsChoice = 'hearts' | 'boost';

/** 소식 카드 하나를 고른다. 어느 쪽이든 주민이 도감에 올라가고, 도감 이정표마다 다이아를 한 번 받는다. */
export function chooseNews(state: GameState, bucket: number, choice: NewsChoice): CommandResult<{ resident: number; kind: number; hearts: number; boosted: boolean; isNew: boolean; diamonds: number }> {
  if (choice !== 'hearts' && choice !== 'boost') return fail(state, 'not_found');
  const v = open(state);
  if (isFail(v)) return v;
  const card = v.news.find((n) => n.bucket === bucket);
  if (!card) return fail(state, 'not_found');
  const now = state.lastSettledAt;
  const hearts = choice === 'hearts' ? Math.max(V.news.minHearts, Math.ceil(villageEffects(v).perHour * V.news.heartsHours)) : 0;
  const isNew = !v.dex.includes(card.resident);
  const dex = isNew ? [...v.dex, card.resident].sort((a, b) => a - b) : v.dex;
  const diamonds = isNew ? V.dex.filter((d) => v.dex.length < d.count && dex.length >= d.count).reduce((sum, d) => sum + d.diamonds, 0) : 0;
  const village: Village = {
    ...v,
    news: v.news.filter((n) => n.bucket !== bucket),
    dex,
    hearts: v.hearts + hearts,
    boostUntil: choice === 'boost' ? now + V.boost.ms : v.boostUntil,
  };
  return { ok: true, state: { ...state, village, diamonds: clampResource(state.diamonds + diamonds) }, resident: card.resident, kind: card.kind, hearts, boosted: choice === 'boost', isNew, diamonds };
}

/** 축제 비용: 시간당 생산 costHours시간치(최소 minCost) */
export const festivalCost = (v: Pick<Village, 'tiles'>): number => Math.max(V.festival.minCost, Math.ceil(villageEffects(v).perHour * V.festival.costHours));

/** 지금 축제를 열 수 있는가(광장이 있고, 이번 주에 열지 않았고, 진행 중이 아니다) */
export function festivalBlocked(v: Village, now: number): FailReason | null {
  if (!v.tiles.some((t) => t?.b === 'plaza')) return 'need_plaza';
  if (v.festivalUntil > now || v.festivalWeek === weekKey(now)) return 'festival_used';
  return null;
}

export function startFestival(state: GameState): CommandResult<{ cost: number }> {
  const v = open(state);
  if (isFail(v)) return v;
  const now = state.lastSettledAt;
  const blocked = festivalBlocked(v, now);
  if (blocked) return fail(state, blocked);
  const cost = festivalCost(v);
  if (v.hearts < cost) return fail(state, 'insufficient_hearts');
  return { ok: true, state: { ...state, village: { ...v, hearts: v.hearts - cost, festivalUntil: now + V.festival.ms, festivalWeek: weekKey(now) } }, cost };
}

/** 알림 점: 고르지 않은 소식 카드 수 + 수확할 ❤️가 저장 한도의 80%를 넘었으면 1 */
export function villageAlerts(s: GameState): number {
  if (!villageUnlocked(s.fans)) return 0;
  const v = villageView(s);
  const cap = stockCap(v);
  return v.news.length + (cap > 0 && v.stock >= cap * 0.8 ? 1 : 0);
}

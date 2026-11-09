/*
 * 팬 마을의 순수 규칙. 게임 규칙은 서버에 없지만 친구 마을을 보여 주고 랭킹(명성)을 매기려면 저장된 마을의 모양을 읽어야 한다.
 * 아래 값은 프런트 `balance.ts`의 `BALANCE.village`(땅 한 변을 정하는 팬 수·최대 레벨·건물 ID와 건물별 최대 개수)와 같아야 한다.
 * (프런트 테스트 `village.test.ts`가 이 파일을 읽어 같은지 확인한다.)
 */

export const VILLAGE_W = 8;
export const VILLAGE_CELLS = VILLAGE_W * VILLAGE_W;
export const VILLAGE_MAX_LEVEL = 10;

/** 팬 수가 fans 이상이면 땅의 한 변이 side다(가운데부터 넓어진다). */
export const VILLAGE_SIDES: readonly { fans: number; side: number }[] = [
  { fans: 30_000, side: 4 },
  { fans: 1_000_000, side: 6 },
  { fans: 100_000_000, side: 8 },
];

export const BUILDING_MAX = {
  cafe: 4,
  goods: 2,
  practice: 2,
  gallery: 2,
  band: 3,
  stall: 2,
  storage: 2,
  park: 3,
  plaza: 1,
} as const;
export type BuildingId = keyof typeof BUILDING_MAX;

/** 응원 깃발 하나가 주는 ❤️. 서버가 정하므로 프런트 balance.ts가 아니라 여기가 원본이다. */
export const FLAG_HEARTS = 15;
/** 깃발을 한 번에 받는 최대 개수(프런트가 받는 ❤️ 상한 안에 든다) */
export const FLAG_CLAIM_BATCH = 100;

export interface TileDto {
  b: BuildingId;
  lv: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBuilding = (v: unknown): v is BuildingId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(BUILDING_MAX, v);

/** 팬 수로 열린 땅의 한 변. 마을이 아직 열리지 않았으면 0 */
export function villageSideOf(fans: unknown): number {
  const f = typeof fans === 'number' && Number.isFinite(fans) ? fans : 0;
  let side = 0;
  for (const s of VILLAGE_SIDES) if (f >= s.fans) side = s.side;
  return side;
}

/** 저장 state에서 마을 칸 64개를 읽는다. 모양이 이상한 칸·한도를 넘은 건물은 빈 칸으로 본다. */
export function tilesOf(state: unknown): (TileDto | null)[] {
  const out: (TileDto | null)[] = Array.from({ length: VILLAGE_CELLS }, () => null);
  if (!isObj(state) || !isObj(state.village) || !Array.isArray(state.village.tiles)) return out;
  const used: Partial<Record<BuildingId, number>> = {};
  state.village.tiles.slice(0, VILLAGE_CELLS).forEach((t: unknown, i: number) => {
    if (!isObj(t) || !isBuilding(t.b)) return;
    const lv = t.lv;
    if (typeof lv !== 'number' || !Number.isInteger(lv) || lv < 1 || lv > VILLAGE_MAX_LEVEL) return;
    if ((used[t.b] ?? 0) >= BUILDING_MAX[t.b]) return;
    used[t.b] = (used[t.b] ?? 0) + 1;
    out[i] = { b: t.b, lv };
  });
  return out;
}

/** 마을 명성 = 건물 레벨 합계 (프런트 `fameOf`와 같다) */
export const villageFameOf = (state: unknown): number => tilesOf(state).reduce((sum, t) => sum + (t?.lv ?? 0), 0);

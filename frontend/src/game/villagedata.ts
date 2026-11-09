import { BALANCE } from './balance';
import type { BuildingId, Village, VillageTile } from './types';

/*
 * 팬 마을의 순수 계산: 땅의 모양·구역, 건물 비용, 인접 배율, 건물이 만드는 효과와 ❤️ 정산.
 * 영구 보너스로 합치는 일은 packdata.ts의 bonuses가 하므로 이 파일은 다른 game 모듈을 가져오지 않는다.
 * 명령(건설·수확·소식·축제)은 village.ts.
 */

const V = BALANCE.village;

interface BuildingDef {
  base: number;
  max: number;
  perLevel?: number;
  perLevelMs?: number;
  perLevelHours?: number;
}
const DEFS = V.buildings as Record<BuildingId, BuildingDef>;

/** 땅은 W×W 고정이고 가운데부터 열린다. 인덱스 = y × W + x */
export const VILLAGE_W = 8;
export const VILLAGE_CELLS = VILLAGE_W * VILLAGE_W;

export type Zone = 'normal' | 'twilight' | 'dark';

export const zoneOfCol = (x: number): Zone => (x <= 2 ? 'normal' : x <= 4 ? 'twilight' : 'dark');
export const cellX = (i: number): number => i % VILLAGE_W;
export const cellY = (i: number): number => Math.floor(i / VILLAGE_W);
export const zoneOf = (i: number): Zone => zoneOfCol(cellX(i));

export const villageUnlocked = (fans: number): boolean => fans >= V.unlockFans;

/** 팬 수로 열린 땅의 한 변. 아직 열리지 않았으면 0 */
export function villageSide(fans: number): number {
  let side = 0;
  for (const s of V.sides) if (fans >= s.fans) side = s.side;
  return side;
}

/** 칸이 열린 땅 안에 있는가 */
export function inWindow(i: number, side: number): boolean {
  if (!Number.isInteger(i) || i < 0 || i >= VILLAGE_CELLS || side <= 0) return false;
  const off = (VILLAGE_W - side) / 2;
  const x = cellX(i);
  const y = cellY(i);
  return x >= off && x < off + side && y >= off && y < off + side;
}

export const emptyVillage = (seed: number, at: number): Village => ({
  seed: seed >>> 0,
  tiles: Array.from({ length: VILLAGE_CELLS }, () => null),
  hearts: V.startHearts,
  stock: 0,
  at,
  boostUntil: 0,
  festivalUntil: 0,
  festivalWeek: '',
  news: [],
  newsBucket: 0,
  dex: [],
  paidSteps: 0,
});

export const buildingMax = (b: BuildingId): number => DEFS[b].max;

/** 건물이 레벨 lv(1~)가 되는 데 드는 ❤️ */
export const heartCost = (b: BuildingId, lv: number): number => Math.ceil(DEFS[b].base * V.costGrowth ** (lv - 1));

/** 레벨 lv까지 올리는 데 쓴 ❤️ 합계 */
export function heartsSpent(b: BuildingId, lv: number): number {
  let sum = 0;
  for (let n = 1; n <= lv; n++) sum += heartCost(b, n);
  return sum;
}

export const countOf = (v: Pick<Village, 'tiles'>, b: BuildingId): number => v.tiles.filter((t) => t?.b === b).length;
export const totalLevels = (v: Pick<Village, 'tiles'>): number => v.tiles.reduce((sum, t) => sum + (t?.lv ?? 0), 0);
/** 마을 명성 = 건물 레벨 합계 (서버 랭킹과 같다) */
export const fameOf = totalLevels;

/** 상하좌우로 붙은 칸 번호 */
export function neighborsOf(i: number): number[] {
  const x = cellX(i);
  const y = cellY(i);
  const out: number[] = [];
  if (y > 0) out.push(i - VILLAGE_W);
  if (x > 0) out.push(i - 1);
  if (x < VILLAGE_W - 1) out.push(i + 1);
  if (y < VILLAGE_W - 1) out.push(i + VILLAGE_W);
  return out;
}

const isPair = (a: BuildingId, b: BuildingId): boolean => V.pairs.some(([p, q]) => (p === a && q === b) || (p === b && q === a));

/** 한 칸 건물의 효과 배율: 1 + (짝 이웃 × synergy) + (이웃 쉼터 레벨 × parkPerLevel), 상한 maxMult */
export function tileMult(tiles: readonly (VillageTile | null)[], i: number): number {
  const t = tiles[i];
  if (!t) return 1;
  let m = 1;
  for (const n of neighborsOf(i)) {
    const u = tiles[n];
    if (!u) continue;
    if (isPair(t.b, u.b)) m += V.synergy;
    if (u.b === 'park') m += V.parkPerLevel * u.lv;
  }
  return Math.min(V.maxMult, m);
}

export interface VillageEffects {
  /** 부스트·축제를 뺀 시간당 ❤️ */
  perHour: number;
  /** ❤️ 저장 한도(시간) */
  capHours: number;
  coin: number;
  fan: number;
  power: number;
  rhyme: { normal: number; dark: number };
  offlineMs: number;
}

/** 지금 마을의 모든 건물이 주는 효과 */
export function villageEffects(v: Pick<Village, 'tiles'>): VillageEffects {
  const fx: VillageEffects = { perHour: 0, capHours: V.capHours, coin: 0, fan: 0, power: 0, rhyme: { normal: 0, dark: 0 }, offlineMs: 0 };
  v.tiles.forEach((t, i) => {
    if (!t) return;
    const lv = Math.min(Math.max(0, t.lv), V.maxLevel);
    const m = tileMult(v.tiles, i);
    const def = DEFS[t.b];
    if (!def) return;
    switch (t.b) {
      case 'cafe':
        fx.perHour += V.heartsPerHour * lv * m;
        break;
      case 'goods':
        fx.coin += (def.perLevel ?? 0) * lv * m;
        break;
      case 'practice':
        fx.power += (def.perLevel ?? 0) * lv * m;
        break;
      case 'gallery':
        fx.fan += (def.perLevel ?? 0) * lv * m;
        break;
      case 'band': {
        const v1 = (def.perLevel ?? 0) * lv * m;
        const zone = zoneOf(i);
        if (zone === 'normal') fx.rhyme.normal += v1;
        else if (zone === 'dark') fx.rhyme.dark += v1;
        else {
          fx.rhyme.normal += v1 * V.twilightShare;
          fx.rhyme.dark += v1 * V.twilightShare;
        }
        break;
      }
      case 'stall':
        fx.offlineMs += (def.perLevelMs ?? 0) * lv * m;
        break;
      case 'storage':
        fx.capHours += (def.perLevelHours ?? 0) * lv * m;
        break;
      default:
        break;
    }
  });
  return fx;
}

const HOUR = 3600_000;

/** ❤️ 생산 배율(부스트 × 축제)이 구간 [a, b)에서 얼마인가. 구간 안에서 바뀌지 않게 호출자가 끊어 준다. */
function segmentMult(v: Pick<Village, 'boostUntil' | 'festivalUntil'>, a: number): number {
  return (v.boostUntil > a ? V.boost.mult : 1) * (v.festivalUntil > a ? V.festival.mult : 1);
}

/** 시각 now에 수확을 기다리는 ❤️. 실제 경과 시간으로 쌓이고 저장 한도에서 멈춘다. */
export function stockAt(v: Village, now: number): number {
  const fx = villageEffects(v);
  const cap = fx.perHour * fx.capHours;
  if (fx.perHour <= 0) return 0;
  if (now <= v.at) return Math.min(v.stock, cap);
  const cuts = [v.at, ...[v.boostUntil, v.festivalUntil].filter((t) => t > v.at && t < now), now].sort((x, y) => x - y);
  let made = 0;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k];
    const b = cuts[k + 1];
    made += fx.perHour * segmentMult(v, a) * ((b - a) / HOUR);
  }
  return Math.min(cap, v.stock + made);
}

/** 부스트·축제를 포함한 지금의 시간당 ❤️ (화면 표시용) */
export function liveRate(v: Village, now: number): number {
  const fx = villageEffects(v);
  return fx.perHour * segmentMult(v, now);
}

/** 저장 한도(❤️) */
export function stockCap(v: Pick<Village, 'tiles'>): number {
  const fx = villageEffects(v);
  return fx.perHour * fx.capHours;
}

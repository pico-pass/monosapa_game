import { describe, expect, it } from 'vitest';
import { BUILDING_MAX, FLAG_CLAIM_BATCH, FLAG_HEARTS, VILLAGE_CELLS, tilesOf, villageFameOf, villageSideOf } from '../rules.js';

describe('마을 땅의 한 변', () => {
  it('팬 수에 따라 4 → 6 → 8로 넓어지고, 열리기 전에는 0이다', () => {
    expect(villageSideOf(0)).toBe(0);
    expect(villageSideOf(29_999)).toBe(0);
    expect(villageSideOf(30_000)).toBe(4);
    expect(villageSideOf(999_999)).toBe(4);
    expect(villageSideOf(1_000_000)).toBe(6);
    expect(villageSideOf(1e8)).toBe(8);
  });

  it('숫자가 아니거나 비정상이면 열리지 않은 것으로 본다', () => {
    expect(villageSideOf(undefined)).toBe(0);
    expect(villageSideOf('1e9')).toBe(0);
    expect(villageSideOf(NaN)).toBe(0);
  });
});

describe('저장된 마을 읽기', () => {
  const cell = (b: string, lv: number) => ({ b, lv });

  it('마을이 없거나 모양이 이상하면 빈 땅이다', () => {
    for (const state of [undefined, null, {}, { village: null }, { village: { tiles: 'x' } }]) {
      const tiles = tilesOf(state);
      expect(tiles).toHaveLength(VILLAGE_CELLS);
      expect(tiles.every((t) => t === null)).toBe(true);
      expect(villageFameOf(state)).toBe(0);
    }
  });

  it('알 수 없는 건물·범위를 벗어난 레벨은 건너뛰고 명성은 레벨 합계다', () => {
    const tiles = Array.from({ length: VILLAGE_CELLS }, () => null) as unknown[];
    tiles[0] = cell('cafe', 3);
    tiles[1] = cell('goods', 10);
    tiles[2] = cell('dragon', 1);
    tiles[3] = cell('cafe', 11);
    tiles[4] = cell('cafe', 0);
    tiles[5] = cell('cafe', 2.5);
    tiles[6] = 'cafe';
    const read = tilesOf({ village: { tiles } });
    expect(read[0]).toEqual({ b: 'cafe', lv: 3 });
    expect(read[1]).toEqual({ b: 'goods', lv: 10 });
    expect(read.slice(2, 7).every((t) => t === null)).toBe(true);
    expect(villageFameOf({ village: { tiles } })).toBe(13);
  });

  it('건물마다 정해진 개수를 넘는 칸은 버린다', () => {
    const tiles = Array.from({ length: BUILDING_MAX.plaza + 2 }, () => cell('plaza', 5));
    const read = tilesOf({ village: { tiles } });
    expect(read.filter((t) => t?.b === 'plaza')).toHaveLength(BUILDING_MAX.plaza);
  });

  it('64칸을 넘는 배열은 앞 64칸만 읽는다', () => {
    const tiles = Array.from({ length: 100 }, () => cell('park', 1));
    expect(tilesOf({ village: { tiles } })).toHaveLength(VILLAGE_CELLS);
  });
});

describe('깃발 상수', () => {
  it('한 번에 받는 깃발이 프런트의 하트 받기 상한(2000) 안에 든다', () => {
    expect(FLAG_CLAIM_BATCH * FLAG_HEARTS).toBeLessThanOrEqual(2000);
  });
});

import { describe, expect, it } from 'vitest';
import * as server from '../../../../backend/src/village/rules';
import { BALANCE, BUILDING_IDS } from '../balance';
import { NEWS_TEXT, residentName } from '../content';
import { bonuses } from '../packdata';
import { createInitialState, validateState } from '../persistence';
import { offlineCapMs } from '../selectors';
import { applyVillageHearts } from '../serverRewards';
import type { BuildingId, GameState, Village, VillageTile } from '../types';
import { buildTile, chooseNews, demolishTile, festivalBlocked, festivalCost, harvestVillage, moveTile, newsFor, refreshNews, settleVillage, startFestival, upgradeTile, villageAlerts, villageView } from '../village';
import { VILLAGE_CELLS, buildingMax, countOf, emptyVillage, fameOf, heartCost, heartsSpent, inWindow, liveRate, stockAt, stockCap, tileMult, totalLevels, villageEffects, villageSide, villageUnlocked } from '../villagedata';

const T0 = 1_700_000_000_000;
const H = 3600_000;
const V = BALANCE.village;
const OPEN_FANS = V.unlockFans;

const village = (patch: Partial<Village> = {}): Village => ({ ...emptyVillage(12345, T0), ...patch });
/** 마을이 열린 팬 수의 상태. 칸 배열은 tiles({칸: 건물})로 채운다. */
const base = (patch: Partial<Village> = {}, state: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), fans: OPEN_FANS, village: village({ hearts: 1000, ...patch }), ...state });
const tiles = (placed: Record<number, [BuildingId, number]>): (VillageTile | null)[] => {
  const t: (VillageTile | null)[] = Array.from({ length: VILLAGE_CELLS }, () => null);
  for (const [i, [b, lv]] of Object.entries(placed)) t[Number(i)] = { b, lv };
  return t;
};
const at = (s: GameState, ms: number): GameState => ({ ...s, lastSettledAt: T0 + ms });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok but got ${JSON.stringify((r as { reason?: string }).reason)}`);
  return r as Extract<T, { ok: true }>;
};
const failReason = (r: { ok: boolean }): string => (r.ok ? 'ok' : (r as unknown as { reason: string }).reason);
const roundTrip = (s: GameState): GameState => {
  const v = validateState(JSON.parse(JSON.stringify(s)));
  if (!v.ok) throw new Error(v.error);
  return v.state;
};

// 땅은 8×8이고 4×4가 열려 있으면 열 2~5, 행 2~5가 열린다. 칸 번호 = 행 × 8 + 열.
const C = (x: number, y: number): number => y * 8 + x;

describe('팬 마을 땅', () => {
  it('팬 3만 명에서 열리고 4×4 → 6×6 → 8×8로 넓어진다', () => {
    expect(villageUnlocked(OPEN_FANS - 1)).toBe(false);
    expect(villageUnlocked(OPEN_FANS)).toBe(true);
    expect(villageSide(OPEN_FANS - 1)).toBe(0);
    expect(villageSide(OPEN_FANS)).toBe(4);
    expect(villageSide(1_000_000)).toBe(6);
    expect(villageSide(100_000_000)).toBe(8);
  });

  it('열린 땅은 가운데부터 바깥으로 넓어진다', () => {
    expect(inWindow(C(2, 2), 4)).toBe(true);
    expect(inWindow(C(5, 5), 4)).toBe(true);
    expect(inWindow(C(1, 2), 4)).toBe(false);
    expect(inWindow(C(6, 6), 4)).toBe(false);
    expect(inWindow(C(1, 1), 6)).toBe(true);
    expect(inWindow(C(0, 0), 6)).toBe(false);
    expect(inWindow(C(0, 0), 8)).toBe(true);
    expect(inWindow(C(7, 7), 8)).toBe(true);
    expect(inWindow(64, 8)).toBe(false);
    expect(inWindow(-1, 8)).toBe(false);
    expect(inWindow(2.5, 8)).toBe(false);
    expect(inWindow(C(3, 3), 0)).toBe(false);
  });

  it('새 마을은 빈 땅 64칸과 시작 하트를 가진다', () => {
    const v = emptyVillage(7, T0);
    expect(v.tiles).toHaveLength(VILLAGE_CELLS);
    expect(v.tiles.every((t) => t === null)).toBe(true);
    expect(v.hearts).toBe(V.startHearts);
  });
});

describe('건설·업그레이드·철거·이사', () => {
  it('열리기 전에는 아무것도 못 한다', () => {
    const s = base({}, { fans: OPEN_FANS - 1 });
    expect(failReason(buildTile(s, C(2, 2), 'cafe'))).toBe('village_locked');
    expect(failReason(harvestVillage(s))).toBe('village_locked');
    expect(failReason(startFestival(s))).toBe('village_locked');
  });

  it('열린 땅 안의 빈 칸에만 짓고 비용은 하트다', () => {
    const s = base();
    expect(failReason(buildTile(s, C(0, 0), 'cafe'))).toBe('tile_invalid');
    expect(failReason(buildTile(s, C(2, 2), 'dragon' as BuildingId))).toBe('not_found');
    const r = ok(buildTile(s, C(2, 2), 'cafe'));
    expect(r.cost).toBe(heartCost('cafe', 1));
    expect(r.state.village.hearts).toBe(1000 - r.cost);
    expect(r.state.village.tiles[C(2, 2)]).toEqual({ b: 'cafe', lv: 1 });
    expect(failReason(buildTile(r.state, C(2, 2), 'goods'))).toBe('tile_taken');
  });

  it('하트가 모자라면 못 짓고, 건물마다 개수 한도가 있다', () => {
    expect(failReason(buildTile(base({ hearts: 5 }), C(2, 2), 'cafe'))).toBe('insufficient_hearts');
    let s = base();
    for (let n = 0; n < buildingMax('plaza'); n++) s = ok(buildTile(s, C(2 + n, 2), 'plaza')).state;
    expect(failReason(buildTile(s, C(2, 3), 'plaza'))).toBe('building_limit');
    expect(countOf(s.village, 'plaza')).toBe(buildingMax('plaza'));
  });

  it('레벨 비용은 ceil(base × costGrowth^(n−1))이고 최대 레벨에서 멈춘다', () => {
    const g = V.costGrowth;
    expect(heartCost('cafe', 1)).toBe(20);
    expect(heartCost('cafe', 2)).toBe(Math.ceil(20 * g));
    expect(heartCost('cafe', 3)).toBe(Math.ceil(20 * g * g));
    expect(heartsSpent('cafe', 3)).toBe(20 + Math.ceil(20 * g) + Math.ceil(20 * g * g));
    const s = base({ hearts: 1e9, tiles: tiles({ [C(2, 2)]: ['cafe', V.maxLevel] }) });
    expect(failReason(upgradeTile(s, C(2, 2)))).toBe('max_level');
    expect(failReason(upgradeTile(s, C(3, 3)))).toBe('not_found');
    const r = ok(upgradeTile(base({ tiles: tiles({ [C(2, 2)]: ['cafe', 1] }) }), C(2, 2)));
    expect(r.cost).toBe(heartCost('cafe', 2));
    expect(r.level).toBe(2);
  });

  it('건물 레벨 합계가 10의 배수에 닿을 때마다 다이아를 한 번씩 받고, 부수고 다시 지어도 또 받지 않는다', () => {
    const every = V.levelDiamonds.every;
    let s = base({ hearts: 1e12, tiles: tiles({ [C(2, 2)]: ['cafe', every - 1] }) });
    const r = ok(upgradeTile(s, C(2, 2)));
    expect(r.diamonds).toBe(V.levelDiamonds.amount);
    expect(r.state.diamonds).toBe(s.diamonds + V.levelDiamonds.amount);
    s = ok(demolishTile(r.state, C(2, 2))).state;
    s = ok(buildTile(s, C(2, 2), 'cafe')).state;
    for (let i = 0; i < every - 1; i++) s = ok(upgradeTile(s, C(2, 2))).state;
    expect(s.diamonds).toBe(r.state.diamonds); // 같은 10에서 두 번째 다이아는 없다
    // 전 건물을 최대 레벨까지 키워도 평생 받는 다이아는 정해져 있다
    const maxLevels = BUILDING_IDS.reduce((sum, b) => sum + buildingMax(b) * V.maxLevel, 0);
    expect(Math.floor(maxLevels / every) * V.levelDiamonds.amount).toBeLessThanOrEqual(30);
  });

  it('철거하면 쓴 하트의 절반을 돌려받는다', () => {
    const s = base({ hearts: 0, tiles: tiles({ [C(2, 2)]: ['cafe', 3] }) });
    const r = ok(demolishTile(s, C(2, 2)));
    expect(r.refund).toBe(Math.floor(heartsSpent('cafe', 3) * V.refundRate));
    expect(r.state.village.hearts).toBe(r.refund);
    expect(r.state.village.tiles[C(2, 2)]).toBeNull();
    expect(failReason(demolishTile(r.state, C(2, 2)))).toBe('not_found');
  });

  it('이사는 빈 칸으로만 가고 비용이 든다', () => {
    const s = base({ tiles: tiles({ [C(2, 2)]: ['goods', 2], [C(3, 2)]: ['park', 1] }) });
    expect(failReason(moveTile(s, C(2, 2), C(3, 2)))).toBe('tile_taken');
    expect(failReason(moveTile(s, C(2, 2), C(0, 0)))).toBe('tile_invalid');
    expect(failReason(moveTile(s, C(4, 4), C(3, 3)))).toBe('not_found');
    expect(failReason(moveTile({ ...s, village: { ...s.village, hearts: 1 } }, C(2, 2), C(4, 4)))).toBe('insufficient_hearts');
    const r = ok(moveTile(s, C(2, 2), C(4, 4)));
    expect(r.state.village.tiles[C(4, 4)]).toEqual({ b: 'goods', lv: 2 });
    expect(r.state.village.tiles[C(2, 2)]).toBeNull();
    expect(r.state.village.hearts).toBe(1000 - V.moveCost);
  });
});

describe('인접 배율과 효과', () => {
  it('짝 이웃은 하나당 +20%', () => {
    const t = tiles({ [C(2, 2)]: ['cafe', 1], [C(3, 2)]: ['goods', 1], [C(2, 3)]: ['gallery', 1], [C(4, 4)]: ['storage', 1] });
    expect(tileMult(t, C(2, 2))).toBeCloseTo(1 + 2 * V.synergy, 10);
    expect(tileMult(t, C(3, 2))).toBeCloseTo(1 + V.synergy, 10); // goods 옆에는 cafe만
    expect(tileMult(t, C(4, 4))).toBe(1);
  });

  it('쉼터는 레벨당 +3%를 이웃에 더하고, 한 건물의 배율은 2배가 상한이다', () => {
    const one = tiles({ [C(3, 3)]: ['cafe', 1], [C(3, 2)]: ['park', 5] });
    expect(tileMult(one, C(3, 3))).toBeCloseTo(1 + 5 * V.parkPerLevel, 10);
    const many = tiles({ [C(3, 3)]: ['cafe', 1], [C(3, 2)]: ['park', 10], [C(2, 3)]: ['park', 10], [C(4, 3)]: ['park', 10], [C(3, 4)]: ['goods', 1] });
    expect(tileMult(many, C(3, 3))).toBe(V.maxMult);
  });

  it('팬카페만 하트를 만들고 시간당 생산은 레벨 × 10 × 배율이다', () => {
    const fx = villageEffects({ tiles: tiles({ [C(2, 2)]: ['cafe', 3], [C(3, 2)]: ['goods', 1] }) });
    expect(fx.perHour).toBeCloseTo(V.heartsPerHour * 3 * (1 + V.synergy), 10);
    expect(villageEffects({ tiles: tiles({ [C(2, 2)]: ['goods', 5] }) }).perHour).toBe(0);
  });

  it('합주실은 구역의 자아에게만, 황혼 골목은 양쪽에 60%씩 준다', () => {
    const per = (BALANCE.village.buildings.band.perLevel as number) * 5;
    const normal = villageEffects({ tiles: tiles({ [C(2, 2)]: ['band', 5] }) }).rhyme;
    expect(normal.normal).toBeCloseTo(per, 10);
    expect(normal.dark).toBe(0);
    const dark = villageEffects({ tiles: tiles({ [C(5, 2)]: ['band', 5] }) }).rhyme;
    expect(dark.dark).toBeCloseTo(per, 10);
    expect(dark.normal).toBe(0);
    const twilight = villageEffects({ tiles: tiles({ [C(3, 2)]: ['band', 5] }) }).rhyme;
    expect(twilight.normal).toBeCloseTo(per * V.twilightShare, 10);
    expect(twilight.dark).toBeCloseTo(per * V.twilightShare, 10);
  });

  it('굿즈샵·연습실·갤러리·포장마차·창고 효과가 영구 보너스와 오프라인 상한에 들어간다', () => {
    const s = base({ tiles: tiles({ [C(2, 2)]: ['goods', 5], [C(4, 2)]: ['practice', 5], [C(2, 4)]: ['gallery', 5], [C(4, 4)]: ['stall', 5] }) });
    const b = bonuses(s);
    expect(b.coin).toBeCloseTo(0.004 * 5, 10);
    expect(b.power).toBeCloseTo(0.004 * 5, 10);
    expect(b.fan).toBeCloseTo(0.004 * 5, 10);
    expect(b.offlineMs).toBe(4 * 60_000 * 5);
    expect(offlineCapMs(s)).toBe(BALANCE.offline.capMs + 4 * 60_000 * 5);
    expect(bonuses(base()).coin).toBe(0);
  });

  it('창고는 저장 한도를 늘린다', () => {
    const t = tiles({ [C(2, 2)]: ['cafe', 1], [C(5, 5)]: ['storage', 4] });
    expect(villageEffects({ tiles: t }).capHours).toBeCloseTo(V.capHours + 0.5 * 4, 10);
    expect(stockCap({ tiles: t })).toBeCloseTo(10 * (V.capHours + 2), 10);
  });

  it('건물이 최대 레벨·최대 개수로 가득 차도 갈래별 이론상 최대치는 정해진 한도 안이다', () => {
    const B = BALANCE.village.buildings;
    const top = (b: 'goods' | 'practice' | 'gallery' | 'band') => B[b].max * V.maxLevel * B[b].perLevel * V.maxMult;
    expect(top('goods')).toBeLessThanOrEqual(0.16);
    expect(top('practice')).toBeLessThanOrEqual(0.16);
    expect(top('gallery')).toBeLessThanOrEqual(0.16);
    expect(top('band')).toBeLessThanOrEqual(0.3);
  });

  it('명성은 건물 레벨 합계다', () => {
    const t = tiles({ [C(2, 2)]: ['cafe', 3], [C(3, 2)]: ['goods', 4] });
    expect(totalLevels({ tiles: t })).toBe(7);
    expect(fameOf({ tiles: t })).toBe(7);
  });
});

describe('하트 수확', () => {
  const withCafe = (patch: Partial<Village> = {}) => base({ tiles: tiles({ [C(2, 2)]: ['cafe', 1] }), at: T0, stock: 0, ...patch });

  it('실제 경과 시간만큼 쌓이고 저장 한도에서 멈춘다', () => {
    const v = withCafe().village;
    expect(stockAt(v, T0)).toBe(0);
    expect(stockAt(v, T0 + 3 * H)).toBeCloseTo(30, 8);
    expect(stockAt(v, T0 + 100 * H)).toBeCloseTo(10 * V.capHours, 8);
  });

  it('팬카페가 없으면 쌓이지 않는다', () => {
    expect(stockAt(base({ at: T0 }).village, T0 + 100 * H)).toBe(0);
  });

  it('수확하면 정수 부분만 받고 소수는 계속 쌓인다', () => {
    const s = at(withCafe(), 1.55 * H); // 15.5
    const r = ok(harvestVillage(s));
    expect(r.hearts).toBe(15);
    expect(r.state.village.hearts).toBe(1000 + 15);
    expect(r.state.village.stock).toBeCloseTo(0.5, 8);
    expect(failReason(harvestVillage(r.state))).toBe('nothing_to_claim');
  });

  it('시계가 거꾸로 가도 줄거나 깨지지 않는다', () => {
    const s = withCafe({ stock: 20, at: T0 + 5 * H });
    const view = villageView(at(s, 1 * H));
    expect(view.stock).toBe(20);
    expect(view.at).toBe(T0 + 5 * H);
  });

  it('응원 부스트와 축제는 켜져 있는 구간에만 배율이 붙는다', () => {
    const v = withCafe({ boostUntil: T0 + 1 * H, festivalUntil: T0 + 2 * H }).village;
    // 0~1h: ×1.5×2, 1~2h: ×2, 2~3h: ×1
    expect(stockAt(v, T0 + 3 * H)).toBeCloseTo(10 * 3 + 10 * 2 + 10, 8);
    expect(liveRate(v, T0 + 0.5 * H)).toBeCloseTo(10 * 3, 8);
    expect(liveRate(v, T0 + 3 * H)).toBe(10);
  });

  it('건물을 바꾸기 직전까지의 하트는 이전 생산 속도로 정산된다', () => {
    const s = at(withCafe(), 2 * H);
    const r = ok(upgradeTile(s, C(2, 2)));
    expect(r.state.village.stock).toBeCloseTo(20, 8); // 레벨 1일 때의 2시간
    expect(r.state.village.at).toBe(T0 + 2 * H);
  });

  it('팬카페를 부수면 한도를 넘는 하트는 잃지 않고 잔고로 간다', () => {
    const s = at(withCafe({ hearts: 0 }), 4 * H);
    const r = ok(demolishTile(s, C(2, 2)));
    expect(r.state.village.stock).toBe(0);
    expect(r.state.village.hearts).toBe(40 + r.refund);
  });
});

describe('마을 소식과 주민 도감', () => {
  it('소식 카드는 씨앗과 시간 구간으로만 정해진다', () => {
    expect(newsFor(99, 1234)).toEqual(newsFor(99, 1234));
    const a = newsFor(99, 1234);
    expect(a.resident).toBeGreaterThanOrEqual(0);
    expect(a.resident).toBeLessThan(V.news.residents);
    expect(a.kind).toBeLessThan(V.news.kinds);
    expect(NEWS_TEXT).toHaveLength(V.news.kinds);
  });

  it('주민 이름 100개는 모두 다르다', () => {
    expect(new Set(Array.from({ length: V.news.residents }, (_, i) => residentName(i))).size).toBe(V.news.residents);
  });

  it('처음에는 한 장, 구간이 바뀔 때마다 한 장씩 늘고 최대 3장만 보관한다', () => {
    const first = refreshNews(village(), T0);
    expect(first.news).toHaveLength(1);
    expect(refreshNews(first, T0 + 1000)).toBe(first);
    const later = refreshNews(first, T0 + 10 * V.news.bucketMs);
    expect(later.news).toHaveLength(V.news.keep);
    expect(later.news[later.news.length - 1].bucket).toBe(Math.floor((T0 + 10 * V.news.bucketMs) / V.news.bucketMs));
  });

  it('하트를 고르면 시간당 생산의 3시간치(최소 15), 부스트를 고르면 2시간 부스트가 켜지고 카드는 사라진다', () => {
    const s = base({ tiles: tiles({ [C(2, 2)]: ['cafe', 1] }) });
    const view = villageView(s);
    const card = view.news[0];
    const hearts = ok(chooseNews(s, card.bucket, 'hearts'));
    expect(hearts.hearts).toBe(Math.max(V.news.minHearts, Math.ceil(10 * V.news.heartsHours)));
    expect(hearts.state.village.hearts).toBe(1000 + hearts.hearts);
    expect(hearts.state.village.news.find((n) => n.bucket === card.bucket)).toBeUndefined();
    expect(failReason(chooseNews(hearts.state, card.bucket, 'hearts'))).toBe('not_found');
    const boost = ok(chooseNews(s, card.bucket, 'boost'));
    expect(boost.state.village.boostUntil).toBe(s.lastSettledAt + V.boost.ms);
    expect(boost.hearts).toBe(0);
    expect(failReason(chooseNews(s, card.bucket, 'x' as 'hearts'))).toBe('not_found');
  });

  it('생산이 없을 때도 최소 하트를 준다', () => {
    const s = base();
    expect(ok(chooseNews(s, villageView(s).news[0].bucket, 'hearts')).hearts).toBe(V.news.minHearts);
  });

  it('새 주민이면 도감에 오르고 도감 이정표에서 다이아를 한 번 받는다', () => {
    const all = Array.from({ length: V.news.residents }, (_, i) => i);
    const card = villageView(base()).news[0];
    // 도감에 카드의 주민이 없는 상태에서 이정표 직전(9명)까지 채운다
    const t = base({ dex: all.filter((n) => n !== card.resident).slice(0, V.dex[0].count - 1) });
    const r = ok(chooseNews(t, card.bucket, 'hearts'));
    expect(r.isNew).toBe(true);
    expect(r.state.village.dex).toHaveLength(V.dex[0].count);
    expect(r.diamonds).toBe(V.dex[0].diamonds);
    expect(r.state.diamonds).toBe(t.diamonds + V.dex[0].diamonds);
    // 이미 만난 주민이면 새로 올라가지 않고 다이아도 없다
    const known = base({ dex: [card.resident] });
    const again = ok(chooseNews(known, card.bucket, 'hearts'));
    expect(again.isNew).toBe(false);
    expect(again.diamonds).toBe(0);
    expect(again.state.village.dex).toEqual([card.resident]);
  });
});

describe('마을 축제', () => {
  const ready = () => base({ hearts: 5000, tiles: tiles({ [C(2, 2)]: ['cafe', 5], [C(3, 2)]: ['plaza', 1] }), at: T0 });

  it('광장이 있어야 열 수 있다', () => {
    expect(failReason(startFestival(base({ tiles: tiles({ [C(2, 2)]: ['cafe', 1] }) })))).toBe('need_plaza');
    expect(festivalBlocked(base().village, T0)).toBe('need_plaza');
  });

  it('비용은 시간당 생산의 6시간치(최소 60)이고 24시간 동안 생산이 두 배다', () => {
    const s = ready();
    const cost = festivalCost(s.village);
    expect(cost).toBe(Math.max(V.festival.minCost, Math.ceil(villageEffects(s.village).perHour * V.festival.costHours)));
    const r = ok(startFestival(s));
    expect(r.cost).toBe(cost);
    expect(r.state.village.hearts).toBe(5000 - cost);
    expect(r.state.village.festivalUntil).toBe(T0 + V.festival.ms);
    expect(liveRate(r.state.village, T0 + H)).toBeCloseTo(villageEffects(s.village).perHour * V.festival.mult, 8);
  });

  it('한 주에 한 번만 열 수 있고 하트가 모자라면 못 연다', () => {
    const s = ready();
    const r = ok(startFestival(s));
    expect(failReason(startFestival(r.state))).toBe('festival_used');
    expect(failReason(startFestival({ ...s, village: { ...s.village, hearts: 1 } }))).toBe('insufficient_hearts');
    // 8일 뒤에는 다른 주라서 다시 열 수 있다
    expect(failReason(startFestival(at(r.state, 8 * 24 * H)))).toBe('ok');
  });
});

describe('알림', () => {
  it('열리기 전에는 0, 열린 뒤에는 새 소식 카드 수와 가득 찬 수확을 센다', () => {
    expect(villageAlerts(base({}, { fans: OPEN_FANS - 1 }))).toBe(0);
    expect(villageAlerts(base())).toBe(1); // 소식 카드 한 장
    const full = at(base({ tiles: tiles({ [C(2, 2)]: ['cafe', 1] }), at: T0 }), 6 * H);
    expect(villageAlerts(full)).toBe(2); // 카드 + 가득 찬 수확
  });
});

describe('저장·불러오기', () => {
  it('마을이 그대로 저장되고 다시 읽힌다', () => {
    const s = base({ hearts: 777, boostUntil: T0 + H, festivalWeek: '2023-11-13', dex: [3, 9], paidSteps: 2, tiles: tiles({ [C(2, 2)]: ['cafe', 3], [C(5, 5)]: ['band', 2] }) });
    const withNews = { ...s, village: settleVillage(s.village, T0) };
    expect(withNews.village.news).toHaveLength(1);
    expect(roundTrip(withNews).village).toEqual(withNews.village);
  });

  it('마을이 없는 예전 저장은 새 마을로 읽는다', () => {
    const raw = JSON.parse(JSON.stringify(createInitialState(T0))) as Record<string, unknown>;
    delete raw.village;
    const v = validateState(raw);
    if (!v.ok) throw new Error(v.error);
    expect(v.state.village.hearts).toBe(V.startHearts);
    expect(v.state.village.tiles.every((t) => t === null)).toBe(true);
  });

  it('이상한 값은 거절하고, 알 수 없는 건물이나 한도를 넘는 건물은 그 칸만 비운다', () => {
    const raw = (patch: (v: Record<string, unknown>) => void) => {
      const o = JSON.parse(JSON.stringify(base().village)) as Record<string, unknown>;
      patch(o);
      return validateState({ ...JSON.parse(JSON.stringify(base())), village: o });
    };
    expect(raw((v) => ((v.tiles as unknown[])[0] = { b: 'cafe', lv: 99 })).ok).toBe(false);
    expect(raw((v) => (v.hearts = -1)).ok).toBe(false);
    expect(raw((v) => (v.news = [{ bucket: 1, resident: 100, kind: 0 }])).ok).toBe(false);
    expect(raw((v) => (v.tiles = 'x')).ok).toBe(false);
    const dropped = raw((v) => {
      const t = v.tiles as unknown[];
      t[0] = { b: 'dragon', lv: 1 };
      t[1] = { b: 'plaza', lv: 1 };
      t[2] = { b: 'plaza', lv: 1 };
    });
    if (!dropped.ok) throw new Error(dropped.error);
    expect(dropped.state.village.tiles[0]).toBeNull();
    expect(dropped.state.village.tiles[1]).toEqual({ b: 'plaza', lv: 1 });
    expect(dropped.state.village.tiles[2]).toBeNull();
  });
});

describe('서버가 정하는 하트', () => {
  it('깃발 하트는 0 이상 상한 안으로만 반영한다', () => {
    const s = base({ hearts: 10 });
    expect(ok(applyVillageHearts(s, 15)).state.village.hearts).toBe(25);
    expect(ok(applyVillageHearts(s, -5)).hearts).toBe(0);
    expect(ok(applyVillageHearts(s, NaN)).hearts).toBe(0);
    expect(ok(applyVillageHearts(s, 1e9)).hearts).toBe(2000);
  });
});

describe('프런트와 서버의 마을 값이 같다', () => {
  it('땅 크기·최대 레벨·건물별 개수가 서버 규칙(backend/src/village/rules.ts)과 같다', () => {
    expect(server.VILLAGE_W).toBe(8);
    expect(server.VILLAGE_MAX_LEVEL).toBe(V.maxLevel);
    expect([...server.VILLAGE_SIDES]).toEqual(V.sides.map((x) => ({ fans: x.fans, side: x.side })));
    expect(Object.keys(server.BUILDING_MAX).sort()).toEqual([...BUILDING_IDS].sort());
    for (const b of BUILDING_IDS) expect(server.BUILDING_MAX[b]).toBe(buildingMax(b));
  });

  it('같은 마을이면 서버가 읽은 명성이 프런트와 같다', () => {
    const state = base({ tiles: tiles({ [C(2, 2)]: ['cafe', 3], [C(3, 2)]: ['goods', 4], [C(5, 5)]: ['plaza', 10] }) });
    const json = JSON.parse(JSON.stringify(state)) as unknown;
    expect(server.villageFameOf(json)).toBe(fameOf(state.village));
    expect(server.villageSideOf(state.fans)).toBe(villageSide(state.fans));
  });
});

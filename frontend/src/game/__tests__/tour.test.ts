import { describe, expect, it } from 'vitest';
import { BALANCE, TOUR_CITIES, TOUR_CITY_IDS, TOUR_FLIGHTS, TOUR_HOME, TOUR_REGIONS, TOUR_REGION_VIBE, tourCityById, tourFlightHours } from '../balance';
import { moreAlerts } from '../alerts';
import { bonuses } from '../packdata';
import { createInitialState, validateState } from '../persistence';
import { fanGainMult, royaltyBreakdown } from '../selectors';
import { abandonTour, claimTour, cityDifficulty, coversAllRegions, eventOf, gradeOf, hotCityAt, maxTourLegs, nextCities, noiseOf, powerMult, routeSynergy, startTour, tourAlerts, tourPlan, tourStatus, tourTimeline, tourUnlocked, validRoute, type TourEvent } from '../tour';
import type { GameState, Persona, TourCityId, TourRun } from '../types';

const R = BALANCE.tour;
const T0 = new Date(2026, 10, 4, 12, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 3600_000;

/** 월클을 클리어한 계정(돌발 사건이 없는 씨앗으로 맞추려면 seedFor를 쓴다) */
const base = (over: Partial<GameState> = {}): GameState => {
  const s = createInitialState(T0);
  return { ...s, fans: 150_000, lastSettledAt: T0, concerts: { ...s.concerts, world: { ...s.concerts.world, cleared: true } }, ...over };
};
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok but got ${JSON.stringify((r as { reason?: string }).reason)}`);
  return r as Extract<T, { ok: true }>;
};
const failReason = (r: { ok: boolean }): string => (r.ok ? 'ok' : (r as unknown as { reason: string }).reason);
const at = (s: GameState, ms: number): GameState => ({ ...s, lastSettledAt: ms });
const normals = (n: number): Persona[] => Array.from({ length: n }, () => 'normal' as const);

/** 이 노선의 모든 칸이 돌발 사건 없이 끝나는 씨앗(투어 번호 no) */
function cleanSeed(n: number, no = 1): number {
  for (let seed = 1; seed < 20_000; seed++) if (Array.from({ length: n }, (_, i) => eventOf(seed, no, i)).every((e) => e === null)) return seed;
  throw new Error('돌발 사건이 없는 씨앗을 못 찾았어요');
}
/** 칸 index에서 사건 e가 나오고 앞 칸들은 사건이 없는 씨앗 */
function seedWith(e: TourEvent, index: number, n: number, no = 1): number {
  for (let seed = 1; seed < 50_000; seed++) {
    if (eventOf(seed, no, index) !== e) continue;
    if (Array.from({ length: n }, (_, i) => i).every((i) => i === index || eventOf(seed, no, i) === null)) return seed;
  }
  throw new Error(`${e} 사건이 나오는 씨앗을 못 찾았어요`);
}
const withSeed = (s: GameState, seed: number): GameState => ({ ...s, tour: { ...s.tour, seed } });
/** 출발한 투어의 전투력 배율을 크게 해서 모든 칸이 S가 되게 한다(결정적인 보상 계산용) */
const strong = (s: GameState): GameState => ({ ...s, tour: { ...s.tour, active: { ...s.tour.active!, power: { normal: 1000, dark: 1000 } } } });

describe('순회공연: 지도 데이터', () => {
  it('도시 12곳이 네 지역에 셋씩 있고 단계는 1~5다', () => {
    expect(TOUR_CITIES).toHaveLength(12);
    expect(new Set(TOUR_CITY_IDS).size).toBe(12);
    for (const r of TOUR_REGIONS) expect(TOUR_CITIES.filter((c) => c.region === r)).toHaveLength(3);
    for (const c of TOUR_CITIES) {
      expect(c.tier).toBeGreaterThanOrEqual(1);
      expect(c.tier).toBeLessThanOrEqual(5);
      expect(c.affinity.normal).toBeGreaterThan(0);
      expect(c.affinity.dark).toBeGreaterThan(0);
    }
    expect(new Set(TOUR_CITIES.map((c) => c.tier)).size).toBe(5); // 1~5단계가 모두 있다
  });

  it('비행 노선: 서울과 알려진 도시만 잇고 중복이 없으며 양방향이다', () => {
    const known = new Set<string>([TOUR_HOME, ...TOUR_CITY_IDS]);
    const seen = new Set<string>();
    for (const [a, b, h] of TOUR_FLIGHTS) {
      expect(known.has(a) && known.has(b)).toBe(true);
      expect(a).not.toBe(b);
      expect(h).toBeGreaterThan(0);
      const key = [a, b].sort().join('|');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(tourFlightHours(a, b)).toBe(h);
      expect(tourFlightHours(b, a)).toBe(h);
    }
    expect(tourFlightHours('seoul', 'london')).toBeNull();
    expect(tourFlightHours('tokyo', 'nowhere')).toBeNull();
  });

  it('서울에서 모든 도시에 닿을 수 있다(지도가 끊기지 않았다)', () => {
    const reached = new Set<string>([TOUR_HOME]);
    const queue: string[] = [TOUR_HOME];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const [a, b] of TOUR_FLIGHTS) {
        const other = a === cur ? b : b === cur ? a : null;
        if (other && !reached.has(other)) {
          reached.add(other);
          queue.push(other);
        }
      }
    }
    for (const id of TOUR_CITY_IDS) expect(reached.has(id), id).toBe(true);
  });

  it('난이도는 단계가 오를수록 커지고, 등급 기준·배율·사건 확률이 말이 된다', () => {
    expect(R.difficulty).toHaveLength(5);
    for (let i = 1; i < 5; i++) expect(R.difficulty[i]).toBeGreaterThan(R.difficulty[i - 1]);
    expect(cityDifficulty('bangkok')).toBe(R.difficulty[0]);
    expect(cityDifficulty('newyork')).toBe(R.difficulty[4]);
    expect(R.gradeAt.S).toBeGreaterThan(R.gradeAt.A);
    expect(R.gradeAt.A).toBeGreaterThan(R.gradeAt.B);
    expect(R.gradeMult.S).toBeGreaterThan(R.gradeMult.A);
    expect(R.gradeMult.A).toBeGreaterThan(R.gradeMult.B);
    expect(R.gradeMult.B).toBeGreaterThan(R.gradeMult.C);
    const e = R.event;
    expect(e.delay + e.hit + e.lost + e.guest).toBeCloseTo(0.15, 10);
    expect(gradeOf(R.gradeAt.S)).toBe(3);
    expect(gradeOf(R.gradeAt.S - 0.001)).toBe(2);
    expect(gradeOf(R.gradeAt.A)).toBe(2);
    expect(gradeOf(R.gradeAt.B)).toBe(1);
    expect(gradeOf(R.gradeAt.B - 0.001)).toBe(0);
  });
});

describe('순회공연: 열림과 노선', () => {
  it('월클 콘서트를 클리어해야 열리고 그전에는 출발할 수 없다', () => {
    const locked = createInitialState(T0);
    expect(tourUnlocked(locked)).toBe(false);
    expect(failReason(startTour({ ...locked, fans: 1e6 }, ['tokyo'], ['normal']))).toBe('tour_locked');
    expect(tourUnlocked(base())).toBe(true);
    expect(tourAlerts(locked)).toBe(0);
  });

  it('한 투어의 최대 도시 수는 처음 3곳이고 투어를 3번 마칠 때마다 1곳씩, 최대 8곳이다', () => {
    const at = (count: number): number => maxTourLegs({ tour: { ...base().tour, count } });
    expect([0, 2, 3, 5, 6, 14, 15, 99].map(at)).toEqual([3, 3, 4, 4, 5, 7, 8, 8]);
  });

  it('노선 검사: 서울에서 이어지고 중복·자아 수·알 수 없는 도시를 막는다', () => {
    expect(validRoute(['tokyo', 'bangkok', 'singapore'], ['normal', 'dark', 'normal'], 3)).toBe(true);
    expect(validRoute([], [], 3)).toBe(false);
    expect(validRoute(['tokyo', 'bangkok', 'singapore', 'sydney'], normals(4), 3)).toBe(false); // 칸 수 초과
    expect(validRoute(['tokyo', 'tokyo'], normals(2), 3)).toBe(false); // 한 도시는 한 번
    expect(validRoute(['london'], normals(1), 3)).toBe(false); // 서울에서 바로 못 간다
    expect(validRoute(['tokyo', 'london'], normals(2), 3)).toBe(false); // 이어지지 않는다
    expect(validRoute(['tokyo', 'bangkok'], normals(1), 3)).toBe(false); // 자아 수가 다르다
    expect(validRoute(['tokyo'], ['bogus'], 3)).toBe(false);
    expect(validRoute(['atlantis'], normals(1), 3)).toBe(false);
    expect(validRoute(['dubai', 'istanbul', 'london'], normals(3), 3)).toBe(true);
  });

  it('이어 갈 수 있는 도시: 비어 있으면 서울에서 닿는 곳, 이미 간 도시는 뺀다', () => {
    expect([...nextCities([])].sort()).toEqual(['bangkok', 'dubai', 'singapore', 'sydney', 'tokyo']);
    const after = nextCities(['tokyo']);
    expect(after).toContain('bangkok');
    expect(after).toContain('la');
    expect(after).not.toContain('tokyo');
    expect(nextCities(['tokyo', 'bangkok'])).not.toContain('tokyo');
  });

  it('노선 시너지: 같은 지역을 이어 가면 +10%씩, 장거리를 이어 타면 −5%씩이고 짧은 칸을 지나면 풀린다', () => {
    expect([0, 1, 2].map((i) => routeSynergy(['tokyo', 'bangkok', 'singapore'], i))).toEqual([1, 1.1, 1.2].map((x) => expect.closeTo(x, 10)));
    // 이스탄불(두바이 지역) 다음 런던은 지역이 달라 보너스가 없고, 파리·베를린은 런던과 같은 유럽이라 이어진다
    expect([0, 1, 2, 3].map((i) => routeSynergy(['istanbul', 'london', 'paris', 'berlin'], i))).toEqual([1, 1, 1.1, 1.2].map((x) => expect.closeTo(x, 10)));
    // 시드니(10시간)→도쿄(9시간)→LA(10시간): 장거리가 이어져 −5%, −10%
    expect(routeSynergy(['sydney', 'tokyo', 'la'], 0)).toBeCloseTo(1, 10);
    expect(routeSynergy(['sydney', 'tokyo', 'la'], 1)).toBeCloseTo(1 - R.longHaulPenalty, 10);
    expect(routeSynergy(['sydney', 'tokyo', 'la'], 2)).toBeCloseTo(1 - 2 * R.longHaulPenalty, 10);
    // 짧은 비행(도쿄→방콕 6시간)이 끼면 장거리 연속이 끊긴다
    expect(routeSynergy(['tokyo', 'bangkok', 'dubai'], 2)).toBeCloseTo(1, 10);
  });

  it('네 지역을 모두 지나는 노선만 투어 완주다', () => {
    expect(coversAllRegions(['tokyo', 'london', 'newyork', 'dubai'])).toBe(true);
    expect(coversAllRegions(['tokyo', 'bangkok', 'singapore', 'london', 'newyork'])).toBe(false); // 오세아니아·중동이 없다
    expect(coversAllRegions([])).toBe(false);
  });

  it('이번 주 핫 도시: 같은 주는 같고 알려진 도시이며 주가 바뀌면 달라질 수 있다', () => {
    const monday = new Date(2026, 10, 2, 0, 0, 0).getTime(); // 월요일 0시
    const sunday = monday + 6 * 24 * HOUR + 23 * HOUR;
    expect(hotCityAt(monday)).toBe(hotCityAt(sunday));
    expect(TOUR_CITY_IDS).toContain(hotCityAt(monday));
    const seen = new Set(Array.from({ length: 30 }, (_, w) => hotCityAt(monday + w * 7 * 24 * HOUR)));
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});

describe('순회공연: 시간표와 돌발 사건', () => {
  it('칸마다 비행(1시간 = 6분)과 공연(15분)이 이어지고 앞 칸 공연이 끝나는 때 다음 비행이 시작한다', () => {
    const seed = cleanSeed(2);
    const run = { no: 1, route: ['tokyo', 'bangkok'] as TourCityId[], personas: normals(2), startedAt: T0 };
    const legs = tourTimeline(run, seed);
    expect(legs[0]).toMatchObject({ index: 0, city: 'tokyo', flightHours: 2, flightMs: 2 * R.flightMsPerHour, departAt: T0, arriveAt: T0 + 12 * MIN, endAt: T0 + 27 * MIN, event: null });
    expect(legs[1]).toMatchObject({ city: 'bangkok', flightHours: 6, flightMs: 36 * MIN, departAt: T0 + 27 * MIN, arriveAt: T0 + 63 * MIN, endAt: T0 + 78 * MIN });
  });

  it('이륙 지연 사건이 있으면 그 칸의 비행이 30% 길어지고 뒤 칸이 모두 밀린다', () => {
    const seed = seedWith('delay', 0, 2);
    const run = { no: 1, route: ['tokyo', 'bangkok'] as TourCityId[], personas: normals(2), startedAt: T0 };
    const legs = tourTimeline(run, seed);
    expect(legs[0].event).toBe('delay');
    expect(legs[0].flightMs).toBe(Math.round(2 * R.flightMsPerHour * R.event.delayMult));
    expect(legs[1].departAt).toBe(legs[0].endAt);
    const clean = tourTimeline(run, cleanSeed(2));
    expect(legs[1].endAt - clean[1].endAt).toBe(legs[0].flightMs - clean[0].flightMs);
  });

  it('같은 입력은 같은 시간표이고, 투어 번호가 다르면 사건도 달라진다', () => {
    const run = { no: 3, route: ['dubai', 'istanbul', 'london'] as TourCityId[], personas: normals(3), startedAt: T0 };
    expect(tourTimeline(run, 12345)).toEqual(tourTimeline(run, 12345));
    const a = Array.from({ length: 200 }, (_, no) => eventOf(777, no + 1, 0));
    const b = Array.from({ length: 200 }, (_, no) => eventOf(777, no + 1, 1));
    expect(a).not.toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(1);
  });

  it('사건 확률은 지연 4%·대박 4%·분실 3%·깜짝 게스트 4%에 가깝고 변수는 ±10% 안이다', () => {
    const N = 40_000;
    const count: Record<string, number> = { delay: 0, hit: 0, lost: 0, guest: 0, none: 0 };
    let lo = 2;
    let hi = 0;
    for (let no = 1; no <= N; no++) {
      count[eventOf(99, no, 0) ?? 'none']++;
      const n = noiseOf(99, no, 0);
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    }
    expect(Math.abs(count.delay / N - R.event.delay)).toBeLessThan(0.006);
    expect(Math.abs(count.hit / N - R.event.hit)).toBeLessThan(0.006);
    expect(Math.abs(count.lost / N - R.event.lost)).toBeLessThan(0.006);
    expect(Math.abs(count.guest / N - R.event.guest)).toBeLessThan(0.006);
    expect(lo).toBeGreaterThanOrEqual(1 - R.noise);
    expect(hi).toBeLessThanOrEqual(1 + R.noise);
    expect(lo).toBeLessThan(0.92);
    expect(hi).toBeGreaterThan(1.08);
  });
});

describe('순회공연: 출발과 정산', () => {
  const route: TourCityId[] = ['tokyo', 'bangkok', 'singapore'];
  const ready = (): GameState => withSeed(base(), cleanSeed(3));

  it('출발하면 투어가 하나 생기고 출발 때의 전투력 배율이 저장되며 투어 번호가 올라간다', () => {
    const s = ready();
    const r = ok(startTour(s, route, ['normal', 'dark', 'normal']));
    expect(r.run).toMatchObject({ no: 1, route, personas: ['normal', 'dark', 'normal'], startedAt: T0, paid: 0 });
    expect(r.run.power.normal).toBeCloseTo(powerMult(s, 'normal'), 10);
    expect(r.run.power.dark).toBeCloseTo(powerMult(s, 'dark'), 10);
    expect(r.state.tour.active).toEqual(r.run);
    expect(r.state.tour.started).toBe(1);
    expect(r.state.tour.count).toBe(0);
    expect(r.state.coins).toBe(s.coins);
  });

  it('이미 투어 중이거나 노선이 올바르지 않으면 못 간다', () => {
    const s = ok(startTour(ready(), route, normals(3))).state;
    expect(failReason(startTour(s, ['sydney'], ['normal']))).toBe('tour_busy');
    expect(failReason(startTour(ready(), ['london'], ['normal']))).toBe('tour_invalid');
    expect(failReason(startTour(ready(), ['tokyo', 'bangkok', 'singapore', 'sydney'], normals(4)))).toBe('tour_invalid'); // 처음엔 3곳까지
  });

  it('시간표대로 단계가 정해진다: 비행 → 공연 → 끝남(정산 대기) → 대기', () => {
    const s0 = ok(startTour(ready(), route, normals(3))).state;
    const phase = (ms: number): string[] => tourStatus(at(s0, ms))!.legs.map((l) => l.phase);
    expect(phase(T0 + 5 * MIN)).toEqual(['flight', 'wait', 'wait']);
    expect(phase(T0 + 15 * MIN)).toEqual(['show', 'wait', 'wait']);
    expect(phase(T0 + 27 * MIN)).toEqual(['done', 'flight', 'wait']);
    const all = tourStatus(at(s0, T0 + 10 * HOUR))!;
    expect(all.legs.map((l) => l.phase)).toEqual(['done', 'done', 'done']);
    expect(all.due).toBe(3);
    expect(all.complete).toBe(true);
    expect(all.finishAt).toBe(all.legs[2].endAt);
    expect(tourStatus(base())).toBeNull();
  });

  it('끝난 칸만 정산하고, 정산한 칸은 다시 받지 못하며, 모든 칸이 끝나면 투어가 마무리된다', () => {
    const s0 = ok(startTour(ready(), route, normals(3))).state;
    expect(failReason(claimTour(at(s0, T0 + 10 * MIN)))).toBe('not_ready');
    expect(failReason(claimTour(base()))).toBe('not_found');
    // 첫 칸만 끝난 시각
    const first = ok(claimTour(at(s0, T0 + 28 * MIN)));
    expect(first.claim.results).toHaveLength(1);
    expect(first.claim.finished).toBe(false);
    expect(first.state.tour.active?.paid).toBe(1);
    expect(first.state.coins).toBe(s0.coins + first.claim.coins);
    expect(failReason(claimTour(first.state))).toBe('not_ready');
    // 나머지가 모두 끝난 시각
    const rest = ok(claimTour(at(first.state, T0 + 10 * HOUR)));
    expect(rest.claim.results.map((r) => r.index)).toEqual([1, 2]);
    expect(rest.claim.finished).toBe(true);
    expect(rest.state.tour.active).toBeNull();
    expect(rest.state.tour.count).toBe(1);
    expect(failReason(claimTour(rest.state))).toBe('not_found');
  });

  it('칸 결과: 등급은 비율로, 코인은 인세 × 단계 × 등급 배율, 팬은 팬 수 × 비율 × 팬 획득 배율이다', () => {
    const s0 = strong(ok(startTour(ready(), ['tokyo'], ['normal'])).state);
    const s1 = at(s0, T0 + 10 * HOUR);
    const r = ok(claimTour(s1));
    const leg = r.claim.results[0];
    const tier = tourCityById('tokyo')!.tier;
    expect(leg.grade).toBe(3); // 전투력 배율이 아주 커서 S
    expect(leg.event).toBeNull();
    const hot = hotCityAt(tourTimeline(s0.tour.active!, s0.tour.seed)[0].arriveAt) === 'tokyo';
    expect(leg.hot).toBe(hot);
    expect(leg.coinSecs).toBeCloseTo(tier * R.coinSecs * R.gradeMult.S * (hot ? R.hotMult : 1), 8);
    expect(leg.coins).toBeCloseTo(leg.coinSecs * royaltyBreakdown(s1, 'normal').perSec, 4);
    expect(leg.fansPct).toBeCloseTo(tier * R.fansPct * R.gradeMult.S, 12);
    expect(leg.fans).toBe(Math.floor(s1.fans * leg.fansPct * fanGainMult(s1)));
    expect(r.claim.coins).toBe(Math.floor(leg.coins));
    expect(r.state.fans).toBe(s1.fans + leg.fans);
    expect(leg.souvenir).toBe(true);
    expect(leg.diamonds).toBe(tier * R.souvenirDiamonds);
    expect(r.claim.diamonds).toBeGreaterThanOrEqual(leg.diamonds);
    expect(r.state.diamonds).toBe(s1.diamonds + r.claim.diamonds);
  });

  it('전투력 배율이 낮으면 등급이 내려가고 보상이 줄며 기념품이 없다', () => {
    const s0 = ok(startTour(ready(), ['bangkok', 'tokyo'], ['normal', 'normal'])).state;
    const weak = { ...s0, tour: { ...s0.tour, active: { ...s0.tour.active!, power: { normal: 0.1, dark: 0.1 } } } };
    const r = ok(claimTour(at(weak, T0 + 10 * HOUR)));
    for (const x of r.claim.results) {
      expect(x.grade).toBe(0);
      expect(x.souvenir).toBe(false);
    }
    expect(r.state.tour.souvenirs).toEqual({});
    expect(r.state.tour.best).toEqual({ bangkok: 0, tokyo: 0 });
    const strongRun = ok(claimTour(at(strong(s0), T0 + 10 * HOUR)));
    expect(strongRun.claim.coins).toBeGreaterThan(r.claim.coins * 3);
  });

  it('돌발 사건: 대박은 팬 +50%, 분실은 코인 −20%, 깜짝 게스트는 래퍼가 있을 때만 공연 힘 +20%', () => {
    const base1 = (e: TourEvent): GameState => strong(ok(startTour(withSeed(base(), seedWith(e, 0, 1)), ['bangkok'], ['normal'])).state);
    const plain = ok(claimTour(at(strong(ok(startTour(withSeed(base(), cleanSeed(1)), ['bangkok'], ['normal'])).state), T0 + 10 * HOUR))).claim.results[0];
    const hit = ok(claimTour(at(base1('hit'), T0 + 10 * HOUR))).claim.results[0];
    expect(hit.event).toBe('hit');
    expect(hit.fansPct / plain.fansPct).toBeCloseTo(R.event.hitMult, 8);
    const lost = ok(claimTour(at(base1('lost'), T0 + 10 * HOUR))).claim.results[0];
    expect(lost.event).toBe('lost');
    expect(lost.coinSecs / plain.coinSecs).toBeCloseTo(R.event.lostMult, 8);
    const noFeat = ok(claimTour(at(base1('guest'), T0 + 10 * HOUR))).claim.results[0];
    expect(noFeat.event).toBeNull(); // 래퍼가 없으면 사건이 일어나지 않는다
    const g0 = base1('guest');
    const withFeat = { ...g0, feat: { ...g0.feat, owned: { 'f-alfrado': 1 } } };
    expect(ok(claimTour(at(withFeat, T0 + 10 * HOUR))).claim.results[0].event).toBe('guest');
  });

  it('네 지역을 모두 지나는 투어는 마지막 칸의 코인·팬이 1.2배다', () => {
    expect(coversAllRegions(['sydney', 'singapore', 'tokyo', 'la'])).toBe(false); // 유럽이 없다
    expect(coversAllRegions(['istanbul', 'london', 'newyork', 'la'])).toBe(false); // 아시아가 없다
    const grand: TourCityId[] = ['bangkok', 'dubai', 'london', 'newyork']; // 아시아·오세아니아·유럽·아메리카
    expect(validRoute(grand, normals(4), 4)).toBe(true);
    expect(coversAllRegions(grand)).toBe(true);
    const s = { ...base(), tour: { ...base().tour, count: 3, seed: cleanSeed(4) } }; // 최대 4곳
    const run = strong(ok(startTour(s, grand, normals(4))).state);
    const r = ok(claimTour(at(run, T0 + 20 * HOUR)));
    expect(r.claim.results.map((x) => x.grand)).toEqual([false, false, false, true]);
    const ratio = r.claim.results[3].coinSecs / (tourCityById('newyork')!.tier * R.coinSecs * R.gradeMult.S * (r.claim.results[3].hot ? R.hotMult : 1));
    expect(ratio).toBeCloseTo(R.grandTour, 8);
  });
});

describe('순회공연: 기념품과 영구 보너스', () => {
  /** 모든 칸이 S가 되도록 한 투어를 끝까지 돌린다 */
  function runTour(s0: GameState, route: TourCityId[]): { state: GameState; diamonds: number } {
    const seeded = withSeed(s0, cleanSeed(route.length, s0.tour.started + 1));
    const started = strong(ok(startTour(seeded, route, normals(route.length))).state);
    const done = ok(claimTour(at(started, started.lastSettledAt + 40 * HOUR)));
    return { state: { ...done.state, lastSettledAt: started.lastSettledAt + 40 * HOUR }, diamonds: done.claim.results.reduce((a, x) => a + x.diamonds, 0) };
  }

  it('도시에서 처음 A 이상이면 기념품(다이아 단계×2)을 받고, 같은 도시에서는 다시 받지 않는다', () => {
    let s = withSeed(base(), cleanSeed(1));
    const a = runTour(s, ['singapore']);
    expect(a.state.tour.souvenirs).toEqual({ singapore: 1 });
    expect(a.diamonds).toBe(tourCityById('singapore')!.tier * R.souvenirDiamonds);
    s = a.state;
    const b = runTour(s, ['singapore']);
    expect(b.diamonds).toBe(0);
    expect(Object.keys(b.state.tour.souvenirs)).toEqual(['singapore']);
    expect(b.state.tour.best.singapore).toBe(3);
  });

  it('한 지역(세 도시)을 다 모으면 다이아 20을, 열두 도시를 다 모으면 60을 한 번씩 받는다', () => {
    let s: GameState = { ...base(), tour: { ...base().tour, count: 6 } }; // 최대 5곳
    let total = 0;
    for (const route of [['tokyo', 'bangkok', 'singapore'], ['dubai', 'istanbul', 'london', 'paris', 'berlin'], ['sydney', 'singapore', 'dubai', 'istanbul'], ['tokyo', 'la', 'newyork', 'saopaulo']] as TourCityId[][]) {
      const r = runTour(s, route);
      s = r.state;
      total += r.diamonds;
    }
    expect(Object.keys(s.tour.souvenirs).sort()).toEqual([...TOUR_CITY_IDS].sort());
    const tiers = TOUR_CITIES.reduce((a, c) => a + c.tier, 0);
    expect(total).toBe(tiers * R.souvenirDiamonds + 4 * R.regionDiamonds + R.allDiamonds);
    // 이미 다 모은 뒤에는 더 받지 않는다
    expect(runTour(s, ['tokyo']).diamonds).toBe(0);
  });

  it('기념품은 그 지역 갈래의 영구 보너스이고, 한 지역을 다 모으면 더 붙는다', () => {
    const none = bonuses(base());
    const withSouv = (ids: TourCityId[]): GameState => ({ ...base(), tour: { ...base().tour, souvenirs: Object.fromEntries(ids.map((i) => [i, 1])) } });
    const one = bonuses(withSouv(['tokyo']));
    expect(one.rhyme.normal - none.rhyme.normal).toBeCloseTo(R.souvenirBonus, 10);
    expect(one.rhyme.dark - none.rhyme.dark).toBeCloseTo(R.souvenirBonus, 10);
    expect(one.coin).toBe(none.coin);
    const asia = bonuses(withSouv(['tokyo', 'bangkok', 'singapore']));
    expect(asia.rhyme.normal - none.rhyme.normal).toBeCloseTo(3 * R.souvenirBonus + R.regionBonus, 10);
    expect(bonuses(withSouv(['london'])).coin - none.coin).toBeCloseTo(R.souvenirBonus, 10);
    expect(bonuses(withSouv(['newyork'])).fan - none.fan).toBeCloseTo(R.souvenirBonus, 10);
    expect(bonuses(withSouv(['dubai'])).power - none.power).toBeCloseTo(R.souvenirBonus, 10);
    for (const region of TOUR_REGIONS) expect(['rhyme', 'coin', 'fan', 'power']).toContain(TOUR_REGION_VIBE[region]);
    // 전부 모으면 네 갈래가 각각 3 × 0.3% + 2%
    const full = bonuses(withSouv([...TOUR_CITY_IDS]));
    const each = 3 * R.souvenirBonus + R.regionBonus;
    expect(full.coin - none.coin).toBeCloseTo(each, 10);
    expect(full.fan - none.fan).toBeCloseTo(each, 10);
    expect(full.power - none.power).toBeCloseTo(each, 10);
    expect(full.rhyme.normal - none.rhyme.normal).toBeCloseTo(each, 10);
  });
});

describe('순회공연: 중단과 알림', () => {
  const route: TourCityId[] = ['tokyo', 'bangkok', 'singapore'];
  const going = (): GameState => ok(startTour(withSeed(base(), cleanSeed(3)), route, normals(3))).state;

  it('중단하면 끝난 칸은 먼저 정산하고 남은 칸은 사라지며 마친 투어로 세지 않고 번호는 소모된다', () => {
    const s = at(going(), T0 + 28 * MIN);
    const r = ok(abandonTour(s));
    expect(r.claim?.results).toHaveLength(1);
    expect(r.state.tour.active).toBeNull();
    expect(r.state.tour.count).toBe(0);
    expect(r.state.tour.started).toBe(1);
    expect(r.state.coins).toBeGreaterThan(s.coins);
    const again = ok(startTour(r.state, route, normals(3)));
    expect(again.run.no).toBe(2); // 같은 사건이 다시 나오지 않는다
    // 끝난 칸이 없으면 정산 없이 그냥 접는다
    const early = ok(abandonTour(at(going(), T0 + 5 * MIN)));
    expect(early.claim).toBeNull();
    expect(early.state.coins).toBe(going().coins);
    expect(failReason(abandonTour(base()))).toBe('not_found');
  });

  it('알림 점: 정산할 수 있는 칸이 있을 때만 켜진다', () => {
    expect(tourAlerts(base())).toBe(0);
    expect(tourAlerts(at(going(), T0 + 5 * MIN))).toBe(0);
    expect(tourAlerts(at(going(), T0 + 28 * MIN))).toBe(1);
    expect(moreAlerts(at(going(), T0 + 28 * MIN)).tour).toBe(1);
    expect(moreAlerts(at(going(), T0 + 5 * MIN)).tour).toBe(0);
    expect(tourAlerts({ ...at(going(), T0 + 28 * MIN), concerts: createInitialState(T0).concerts })).toBe(0);
  });
});

describe('순회공연: 노선 미리보기', () => {
  it('칸마다 시간·시너지·등급·보상을 미리 계산하고 노선이 올바른지 알려 준다', () => {
    const s = base();
    const plan = tourPlan(s, ['tokyo', 'bangkok', 'singapore'], ['normal', 'dark', 'normal']);
    expect(plan.valid).toBe(true);
    expect(plan.legs.map((l) => l.city)).toEqual(['tokyo', 'bangkok', 'singapore']);
    expect(plan.totalMs).toBe(plan.legs.reduce((a, l) => a + l.durationMs, 0));
    expect(plan.legs[0].durationMs).toBe(2 * R.flightMsPerHour + R.showMs);
    expect(plan.legs.map((l) => l.synergy)).toEqual([1, 1.1, 1.2].map((x) => expect.closeTo(x, 10)));
    for (const l of plan.legs) expect(l.coins).toBeGreaterThan(0);
    expect(plan.coins).toBe(Math.floor(plan.legs.reduce((a, l) => a + l.coins, 0)));
    expect(tourPlan(s, ['london'], ['normal']).valid).toBe(false);
    expect(tourPlan(s, [], []).valid).toBe(false);
    expect(tourPlan(s, [], []).legs).toEqual([]);
  });

  it('전투력 배율이 커질수록 예상 등급이 오르고, 기념품이 가능한 칸을 알려 준다', () => {
    const s = base();
    const weakPlan = tourPlan({ ...s, equipment: { mic: 0, studio: 0, promotion: 0 }, darkEquipment: { mic: 0, studio: 0, promotion: 0 }, musicPower: 0, dripPower: 0 }, ['singapore'], ['normal']);
    const strongPlan = tourPlan({ ...s, equipment: { mic: 20, studio: 20, promotion: 20 }, darkEquipment: { mic: 20, studio: 20, promotion: 20 }, musicPower: 100, dripPower: 100 }, ['singapore'], ['normal']);
    expect(strongPlan.legs[0].ratio).toBeGreaterThan(weakPlan.legs[0].ratio);
    expect(strongPlan.legs[0].grade).toBeGreaterThanOrEqual(weakPlan.legs[0].grade);
    expect(strongPlan.legs[0].souvenir).toBe(true);
    const got = tourPlan({ ...s, tour: { ...s.tour, souvenirs: { singapore: 1 } } }, ['singapore'], ['normal']);
    expect(got.legs[0].souvenir).toBe(false);
  });

  it('자아 궁합이 비율에 곱해진다(파리는 일반, 베를린은 어둠에 유리)', () => {
    const s = base();
    const p = (city: TourCityId, persona: Persona): number => tourPlan(s, ['dubai', 'istanbul', 'london', city === 'paris' ? 'paris' : 'berlin'].slice(0, 4) as TourCityId[], ['normal', 'normal', 'normal', persona]).legs[3].ratio;
    expect(p('paris', 'normal')).toBeGreaterThan(p('paris', 'dark'));
    expect(p('berlin', 'dark')).toBeGreaterThan(p('berlin', 'normal'));
  });
});

describe('순회공연: 저장', () => {
  const route: TourCityId[] = ['tokyo', 'bangkok'];

  it('진행 중인 투어·기념품·기록이 저장·불러오기를 거쳐도 그대로다', () => {
    const s0 = ok(startTour(withSeed(base(), cleanSeed(2)), route, ['normal', 'dark'])).state;
    const s: GameState = { ...s0, tour: { ...s0.tour, count: 4, started: 4, souvenirs: { singapore: 1, newyork: 1 }, best: { singapore: 3, newyork: 2, tokyo: 1 } } };
    const v = ok(validateState(JSON.parse(JSON.stringify(s))));
    expect(v.state.tour).toEqual(s.tour);
  });

  it('예전 저장은 새 순회공연으로 읽는다', () => {
    const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    delete raw.tour;
    const v = ok(validateState(raw));
    expect(v.state.tour).toMatchObject({ count: 0, started: 0, active: null, souvenirs: {}, best: {} });
  });

  it('알 수 없는 도시는 버리고, 올바르지 않은 진행 중 투어는 없는 것으로 읽는다', () => {
    const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    const run: TourRun = { no: 2, route, personas: ['normal', 'dark'], startedAt: T0, paid: 1, power: { normal: 3, dark: 4 } };
    raw.tour = { seed: 9, count: 1, started: 0, souvenirs: { tokyo: 1, atlantis: 1 }, best: { tokyo: 2, atlantis: 3 }, active: run };
    const v = ok(validateState(raw));
    expect(v.state.tour.souvenirs).toEqual({ tokyo: 1 });
    expect(v.state.tour.best).toEqual({ tokyo: 2 });
    expect(v.state.tour.active).toEqual(run);
    expect(v.state.tour.started).toBe(2); // 진행 중인 투어 번호보다 작지 않게 맞춘다
    for (const bad of [{ ...run, route: ['tokyo', 'london'] }, { ...run, route: ['tokyo', 'atlantis'] }, { ...run, personas: ['normal'] }, { ...run, route: ['tokyo', 'tokyo'] }, { ...run, personas: ['normal', 'x'] }]) {
      raw.tour = { seed: 9, active: bad };
      expect(ok(validateState(raw)).state.tour.active).toBeNull();
    }
    raw.tour = { seed: 9, active: { ...run, paid: 99 } };
    expect(ok(validateState(raw)).state.tour.active?.paid).toBe(2); // 칸 수를 넘지 못한다
  });

  it('모양이 틀린 값은 거절한다', () => {
    const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    for (const tour of ['x', { souvenirs: 'x' }, { best: 'x' }, { best: { tokyo: 9 } }, { count: -1 }, { active: 'x' }, { active: { route, personas: ['normal', 'dark'], no: 0, startedAt: T0, paid: 0, power: { normal: 1, dark: 1 } } }]) {
      expect(validateState({ ...raw, tour }).ok, JSON.stringify(tour)).toBe(false);
    }
  });
});

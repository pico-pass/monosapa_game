import { BALANCE, TOUR_CITIES, TOUR_CITY_IDS, TOUR_HOME, TOUR_REGIONS, tourCityById, tourFlightHours } from './balance';
import { weekKey } from './missions';
import { clampResource, fanGainMult, levelUpDiamonds, playerLevel, royaltyBreakdown } from './selectors';
import { mix } from './streaming';
import { towerPower } from './tower';
import type { CommandResult, Fail, FailReason, GameState, Persona, Tour, TourCityId, TourRun } from './types';

/*
 * 순회공연 「투어 지도」. 서울에서 출발해 연결된 도시를 이어 노선을 짜고 도시마다 세울 자아를 골라 출발하면, 비행(실제 시간)과 공연을 거쳐 칸마다 정산된다.
 * 모든 시각은 출발 시각 startedAt에서 노선·씨앗·투어 번호만으로 계산한다(tourTimeline). 돌발 사건과 ±10% 변수도 (씨앗, 투어 번호, 칸 번호)로만 정해서
 * 같은 상태는 늘 같은 결과이고, 출발한 투어를 중단했다 다시 시작해도 번호가 올라가서 사건을 미리 보고 피하지 못한다.
 * 결과는 출발할 때의 전투력(run.power)으로 계산해서 출발 전 미리보기(tourPlan)와 같다. 수치는 balance.ts의 BALANCE.tour·TOUR_CITIES·TOUR_FLIGHTS.
 */

const R = BALANCE.tour;
const SALT = 0x746f7572;
const HOT_SALT = 0x686f7463;
const PERSONAS: readonly Persona[] = ['normal', 'dark'];

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export type TourEvent = 'delay' | 'hit' | 'lost' | 'guest';
export const TOUR_GRADES = ['C', 'B', 'A', 'S'] as const;

export const tourUnlocked = (s: Pick<GameState, 'concerts'>): boolean => s.concerts.world.cleared;
/** 한 투어에 갈 수 있는 최대 도시 수: 처음 baseLegs, 투어를 legsEvery번 마칠 때마다 +1 */
export const maxTourLegs = (s: Pick<GameState, 'tour'>): number => Math.min(R.maxLegs, R.baseLegs + Math.floor(s.tour.count / R.legsEvery));

export const emptyTour = (seed: number): Tour => ({ seed, count: 0, started: 0, active: null, souvenirs: {}, best: {} });

/* ---------- 노선 ---------- */

/** 이 노선의 끝에서 이어 갈 수 있는 도시들(이미 간 도시는 뺀다). 노선이 비어 있으면 서울에서 갈 수 있는 도시. */
export function nextCities(route: readonly TourCityId[]): TourCityId[] {
  const from = route.length > 0 ? route[route.length - 1] : TOUR_HOME;
  return TOUR_CITY_IDS.filter((c) => !route.includes(c) && tourFlightHours(from, c) !== null);
}

/** 노선이 올바른가: 도시 수가 1~max, 자아 수가 같고, 알려진 도시·자아이며, 한 도시는 한 번, 서울에서 시작해 차례로 비행 노선이 이어진다. */
export function validRoute(route: readonly string[], personas: readonly string[], max: number): boolean {
  if (route.length < 1 || route.length > max || personas.length !== route.length) return false;
  if (new Set(route).size !== route.length) return false;
  if (!personas.every((p) => PERSONAS.includes(p as Persona))) return false;
  let prev: string = TOUR_HOME;
  for (const c of route) {
    if (!tourCityById(c) || tourFlightHours(prev, c) === null) return false;
    prev = c;
  }
  return true;
}

/** i번째 칸의 노선 시너지: 바로 앞 칸들에서 같은 지역을 이어 간 수마다 +regionStreak(최대 regionStreakMax), 장거리를 이어 탄 수마다 −longHaulPenalty */
export function routeSynergy(route: readonly TourCityId[], i: number): number {
  const city = tourCityById(route[i]);
  if (!city) return 1;
  let same = 0;
  for (let k = i - 1; k >= 0 && tourCityById(route[k])?.region === city.region; k--) same++;
  const streak = Math.min(R.regionStreakMax, same * R.regionStreak);
  const hours = (k: number): number => tourFlightHours(k === 0 ? TOUR_HOME : route[k - 1], route[k]) ?? 0;
  let longRun = 0;
  if (hours(i) >= R.longHaulHours) for (let k = i - 1; k >= 0 && hours(k) >= R.longHaulHours; k--) longRun++;
  const fatigue = Math.min(R.longHaulMax, longRun) * R.longHaulPenalty;
  return (1 + streak) * (1 - fatigue);
}

/** 네 지역을 모두 지나는 노선인가(투어 완주 보너스) */
export const coversAllRegions = (route: readonly TourCityId[]): boolean => TOUR_REGIONS.every((r) => route.some((c) => tourCityById(c)?.region === r));

/** 도시 난이도: 도시 단계에 정해진 값(전투력 배율과 견준다) */
export const cityDifficulty = (city: TourCityId): number => R.difficulty[(tourCityById(city)?.tier ?? 1) - 1];

/**
 * 그 자아의 전투력 배율 = 무한의 계단 전투력 ÷ 레벨 기본 전투력(장비·클릭·전투력 보너스가 만드는 배수).
 * 레벨에 따라 커지는 기본 전투력은 빼서, 후반에도 투자(장비·보너스)와 노선 선택이 등급을 가르게 한다.
 */
export function powerMult(s: GameState, persona: Persona): number {
  const T = BALANCE.tower;
  return towerPower(s, persona) / (T.basePower + T.perLevel * (playerLevel(s.fans) - 1));
}

/** 이번 주(월요일 기준 기기 시간대)의 핫 도시. 그 시각에 이 도시에서 하는 공연은 코인이 hotMult배다. */
export function hotCityAt(ms: number): TourCityId {
  const n = Number(weekKey(ms).replace(/-/g, ''));
  return TOUR_CITY_IDS[mix((SALT ^ HOT_SALT) >>> 0, n) % TOUR_CITY_IDS.length];
}

/* ---------- 시간표 ---------- */

/** (씨앗, 투어 번호, 칸 번호, 종류 k)로 정하는 0~1 값 */
const draw = (seed: number, no: number, index: number, k: number): number => mix((seed ^ SALT) >>> 0, (no * 16 + index) * 8 + k) / 4294967296;

/** 칸의 돌발 사건: 칸마다 event 확률(지연 4% · 대박 4% · 분실 3% · 깜짝 게스트 4%) */
export function eventOf(seed: number, no: number, index: number): TourEvent | null {
  const r = draw(seed, no, index, 1);
  const e = R.event;
  if (r < e.delay) return 'delay';
  if (r < e.delay + e.hit) return 'hit';
  if (r < e.delay + e.hit + e.lost) return 'lost';
  if (r < e.delay + e.hit + e.lost + e.guest) return 'guest';
  return null;
}

/** 칸의 ±noise 변수(1 근처) */
export const noiseOf = (seed: number, no: number, index: number): number => 1 + (draw(seed, no, index, 0) * 2 - 1) * R.noise;

export interface TourLeg {
  index: number;
  city: TourCityId;
  persona: Persona;
  flightHours: number;
  /** 실제 비행 시간(이륙 지연이면 늘어난다) */
  flightMs: number;
  /** 비행을 시작하는 시각(앞 칸 공연이 끝난 때) */
  departAt: number;
  /** 도착해서 공연이 시작되는 시각 */
  arriveAt: number;
  /** 공연이 끝나 정산할 수 있는 시각 */
  endAt: number;
  event: TourEvent | null;
}

/** 투어의 칸별 시간표. 같은 투어는 늘 같은 시각이다. */
export function tourTimeline(run: Pick<TourRun, 'no' | 'route' | 'personas' | 'startedAt'>, seed: number): TourLeg[] {
  const legs: TourLeg[] = [];
  let t = run.startedAt;
  let prev: string = TOUR_HOME;
  run.route.forEach((city, index) => {
    const flightHours = tourFlightHours(prev, city) ?? 0;
    const event = eventOf(seed, run.no, index);
    const flightMs = Math.round(flightHours * R.flightMsPerHour * (event === 'delay' ? R.event.delayMult : 1));
    const arriveAt = t + flightMs;
    const endAt = arriveAt + R.showMs;
    legs.push({ index, city, persona: run.personas[index] ?? 'normal', flightHours, flightMs, departAt: t, arriveAt, endAt, event });
    t = endAt;
    prev = city;
  });
  return legs;
}

export type TourPhase = 'paid' | 'done' | 'show' | 'flight' | 'wait';

export interface TourStatus {
  run: TourRun;
  legs: (TourLeg & { phase: TourPhase })[];
  /** 정산할 수 있는 칸 수(공연이 끝났고 아직 정산하지 않은) */
  due: number;
  finishAt: number;
  /** 모든 칸의 공연이 끝났다 */
  complete: boolean;
}

export function tourStatus(s: GameState, now = s.lastSettledAt): TourStatus | null {
  const run = s.tour.active;
  if (!run) return null;
  const legs = tourTimeline(run, s.tour.seed).map((l) => {
    const phase: TourPhase = l.index < run.paid ? 'paid' : l.endAt <= now ? 'done' : l.arriveAt <= now ? 'show' : l.departAt <= now ? 'flight' : 'wait';
    return { ...l, phase };
  });
  return { run, legs, due: legs.filter((l) => l.phase === 'done').length, finishAt: legs[legs.length - 1]?.endAt ?? run.startedAt, complete: legs.every((l) => l.phase === 'paid' || l.phase === 'done') };
}

/* ---------- 결과 계산 ---------- */

export interface TourLegResult {
  index: number;
  city: TourCityId;
  persona: Persona;
  /** 0 C · 1 B · 2 A · 3 S */
  grade: number;
  /** 공연 힘 ÷ 도시 난이도(변수·돌발 사건 포함) */
  ratio: number;
  event: TourEvent | null;
  /** 이번 주 핫 도시에서 했다 */
  hot: boolean;
  /** 투어 완주 보너스(네 지역을 모두 지난 노선의 마지막 칸) */
  grand: boolean;
  /** 인세 초 분량 */
  coinSecs: number;
  coins: number;
  fansPct: number;
  fans: number;
  /** 이 칸에서 처음 기념품을 얻었다 */
  souvenir: boolean;
  /** 기념품·지역 완성·열두 도시 완성으로 받은 다이아 */
  diamonds: number;
}

export function gradeOf(ratio: number): number {
  return ratio >= R.gradeAt.S ? 3 : ratio >= R.gradeAt.A ? 2 : ratio >= R.gradeAt.B ? 1 : 0;
}

const ownsFeat = (s: Pick<GameState, 'feat'>): boolean => Object.values(s.feat.owned).some((v) => v > 0);

/** 칸 하나의 공연 힘(전투력 배율 × 도시 궁합 × 노선 시너지). 난이도로 나눈 값이 비율이다. */
export function legPower(run: { route: readonly TourCityId[]; personas: readonly Persona[]; power: Record<Persona, number> }, i: number): number {
  const city = tourCityById(run.route[i]);
  const persona = run.personas[i] ?? 'normal';
  if (!city) return 0;
  return (run.power[persona] ?? 0) * city.affinity[persona] * routeSynergy(run.route, i);
}

/** 칸 하나의 결과. 코인·팬은 그 시점의 상태(인세·팬 수·팬 획득 배율)로 계산한다. */
function legResult(s: GameState, run: TourRun, leg: TourLeg, souvenirs: Partial<Record<TourCityId, 1>>): TourLegResult {
  const city = tourCityById(leg.city)!;
  const event = leg.event === 'guest' && !ownsFeat(s) ? null : leg.event;
  const ratio = (legPower(run, leg.index) * (event === 'guest' ? R.event.guestMult : 1) * noiseOf(s.tour.seed, run.no, leg.index)) / cityDifficulty(leg.city);
  const grade = gradeOf(ratio);
  const letter = TOUR_GRADES[grade];
  const last = leg.index === run.route.length - 1;
  const grand = last && coversAllRegions(run.route);
  const hot = hotCityAt(leg.arriveAt) === leg.city;
  const coinSecs = city.tier * R.coinSecs * R.gradeMult[letter] * (hot ? R.hotMult : 1) * (event === 'lost' ? R.event.lostMult : 1) * (grand ? R.grandTour : 1);
  const fansPct = city.tier * R.fansPct * R.gradeMult[letter] * (event === 'hit' ? R.event.hitMult : 1) * (grand ? R.grandTour : 1);
  const souvenir = grade >= 2 && souvenirs[leg.city] === undefined;
  let diamonds = 0;
  if (souvenir) {
    const after = { ...souvenirs, [leg.city]: 1 as const };
    diamonds += city.tier * R.souvenirDiamonds;
    if (TOUR_CITIES.filter((c) => c.region === city.region).every((c) => after[c.id] !== undefined)) diamonds += R.regionDiamonds;
    if (TOUR_CITY_IDS.every((c) => after[c] !== undefined)) diamonds += R.allDiamonds;
  }
  return {
    index: leg.index,
    city: leg.city,
    persona: leg.persona,
    grade,
    ratio,
    event,
    hot,
    grand,
    coinSecs,
    coins: coinSecs * royaltyBreakdown(s, leg.persona).perSec,
    fansPct,
    fans: Math.floor(s.fans * fansPct * fanGainMult(s)),
    souvenir,
    diamonds,
  };
}

export interface TourClaim {
  results: TourLegResult[];
  coins: number;
  fans: number;
  /** 기념품 다이아 + 팬이 늘어 플레이어 레벨이 오르며 받은 다이아 */
  diamonds: number;
  /** 이번 정산으로 모든 칸이 끝나 투어가 마무리됐다 */
  finished: boolean;
}

/** 공연이 끝난 칸들을 정산한다. 진행 중인 투어가 없거나 정산할 칸이 없으면 claim이 null이다. */
export function settleTour(state: GameState): { state: GameState; claim: TourClaim | null } {
  const run = state.tour.active;
  if (!run) return { state, claim: null };
  const due = tourTimeline(run, state.tour.seed).filter((l) => l.index >= run.paid && l.endAt <= state.lastSettledAt);
  if (due.length === 0) return { state, claim: null };
  const souvenirs = { ...state.tour.souvenirs };
  const best = { ...state.tour.best };
  const results: TourLegResult[] = [];
  for (const leg of due) {
    const r = legResult(state, run, leg, souvenirs);
    if (r.souvenir) souvenirs[leg.city] = 1;
    best[leg.city] = Math.max(best[leg.city] ?? 0, r.grade);
    results.push(r);
  }
  const coins = Math.floor(results.reduce((a, x) => a + x.coins, 0));
  const fanGain = results.reduce((a, x) => a + x.fans, 0);
  const fans = clampResource(state.fans + fanGain);
  const diamonds = results.reduce((a, x) => a + x.diamonds, 0) + levelUpDiamonds(state.fans, fans);
  const paid = run.paid + due.length;
  const finished = paid >= run.route.length;
  const next: GameState = {
    ...state,
    coins: clampResource(state.coins + coins),
    fans,
    diamonds: clampResource(state.diamonds + diamonds),
    tour: { ...state.tour, souvenirs, best, count: state.tour.count + (finished ? 1 : 0), active: finished ? null : { ...run, paid } },
  };
  return { state: next, claim: { results, coins, fans: fanGain, diamonds, finished } };
}

/** 더보기 알림 점: 정산할 수 있는 칸이 있으면 1 */
export function tourAlerts(s: GameState): number {
  if (!tourUnlocked(s)) return 0;
  const st = tourStatus(s);
  return st && st.due > 0 ? 1 : 0;
}

/* ---------- 명령 ---------- */

/** 노선과 자아를 정해 출발한다. 투어는 한 번에 하나이고, 출발할 때의 전투력이 결과에 쓰인다. */
export function startTour(state: GameState, route: readonly TourCityId[], personas: readonly Persona[]): CommandResult<{ run: TourRun }> {
  if (!tourUnlocked(state)) return fail(state, 'tour_locked');
  if (state.tour.active) return fail(state, 'tour_busy');
  if (!validRoute(route, personas, maxTourLegs(state))) return fail(state, 'tour_invalid');
  const run: TourRun = {
    no: state.tour.started + 1,
    route: [...route],
    personas: [...personas],
    startedAt: state.lastSettledAt,
    paid: 0,
    power: { normal: powerMult(state, 'normal'), dark: powerMult(state, 'dark') },
  };
  return { ok: true, state: { ...state, tour: { ...state.tour, started: state.tour.started + 1, active: run } }, run };
}

/** 끝난 칸의 보상을 받는다. 모든 칸이 끝났으면 투어가 마무리된다. */
export function claimTour(state: GameState): CommandResult<{ claim: TourClaim }> {
  if (!tourUnlocked(state)) return fail(state, 'tour_locked');
  if (!state.tour.active) return fail(state, 'not_found');
  const r = settleTour(state);
  if (!r.claim) return fail(state, 'not_ready');
  return { ok: true, state: r.state, claim: r.claim };
}

/** 진행 중인 투어를 중단한다. 이미 끝난 칸은 먼저 정산하고 남은 칸은 사라진다(마친 투어로 세지 않는다). */
export function abandonTour(state: GameState): CommandResult<{ claim: TourClaim | null }> {
  if (!state.tour.active) return fail(state, 'not_found');
  const r = settleTour(state);
  return { ok: true, state: { ...r.state, tour: { ...r.state.tour, active: null } }, claim: r.claim };
}

/* ---------- 미리보기 ---------- */

export interface TourPlanLeg {
  city: TourCityId;
  persona: Persona;
  flightHours: number;
  /** 비행 + 공연 시간 */
  durationMs: number;
  synergy: number;
  /** 공연 힘 ÷ 난이도(변수·사건 제외) */
  ratio: number;
  grade: number;
  hot: boolean;
  /** 인세 초 분량 */
  coinSecs: number;
  coins: number;
  fansPct: number;
  fans: number;
  /** 이 칸에서 기념품을 얻을 수 있다(처음이고 A 이상) */
  souvenir: boolean;
}

export interface TourPlan {
  valid: boolean;
  legs: TourPlanLeg[];
  totalMs: number;
  coins: number;
  fans: number;
  grand: boolean;
}

/** 지금 상태로 노선을 가정했을 때의 예상(사건·변수 제외). 노선이 올바르지 않으면 valid가 false다. */
export function tourPlan(s: GameState, route: readonly TourCityId[], personas: readonly Persona[]): TourPlan {
  const valid = validRoute(route, personas, maxTourLegs(s));
  const power = { normal: powerMult(s, 'normal'), dark: powerMult(s, 'dark') };
  const grand = route.length > 0 && coversAllRegions(route);
  let t = s.lastSettledAt;
  let prev: string = TOUR_HOME;
  const legs: TourPlanLeg[] = [];
  route.forEach((city, i) => {
    const def = tourCityById(city);
    const persona = personas[i] ?? 'normal';
    const hours = tourFlightHours(prev, city) ?? 0;
    const durationMs = Math.round(hours * R.flightMsPerHour) + R.showMs;
    t += durationMs;
    prev = city;
    if (!def) return;
    const ratio = legPower({ route, personas, power }, i) / cityDifficulty(city);
    const grade = gradeOf(ratio);
    const last = i === route.length - 1;
    const hot = hotCityAt(t - R.showMs) === city;
    const g = grand && last ? R.grandTour : 1;
    const coinSecs = def.tier * R.coinSecs * R.gradeMult[TOUR_GRADES[grade]] * (hot ? R.hotMult : 1) * g;
    const fansPct = def.tier * R.fansPct * R.gradeMult[TOUR_GRADES[grade]] * g;
    legs.push({
      city,
      persona,
      flightHours: hours,
      durationMs,
      synergy: routeSynergy(route, i),
      ratio,
      grade,
      hot,
      coinSecs,
      coins: coinSecs * royaltyBreakdown(s, persona).perSec,
      fansPct,
      fans: Math.floor(s.fans * fansPct * fanGainMult(s)),
      souvenir: grade >= 2 && s.tour.souvenirs[city] === undefined,
    });
  });
  return { valid, legs, totalMs: legs.reduce((a, x) => a + x.durationMs, 0), coins: Math.floor(legs.reduce((a, x) => a + x.coins, 0)), fans: legs.reduce((a, x) => a + x.fans, 0), grand };
}

/** 그 도시에서 더 잘 맞는 자아(전투력 × 궁합이 큰 쪽, 같으면 일반) */
export function bestPersonaFor(s: GameState, city: TourCityId): Persona {
  const def = tourCityById(city);
  if (!def) return 'normal';
  return powerMult(s, 'dark') * def.affinity.dark > powerMult(s, 'normal') * def.affinity.normal ? 'dark' : 'normal';
}

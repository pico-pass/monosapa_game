import { BALANCE } from './balance';
import { clampResource, productionMultiplier, royaltyBreakdown } from './selectors';
import type { AdvanceContext, AdvanceResult, EngineEvent, GameState } from './types';

const P = BALANCE.persona;
/** 구간 경계 계산에서 부동소수 오차를 흡수한다. */
const EPS = 1e-9;

export const ONLINE: AdvanceContext = { efficiency: 1 };
export const OFFLINE: AdvanceContext = { efficiency: BALANCE.offline.efficiency };

/**
 * 시간 전진 순수 함수. state.lastSettledAt부터 durationMs만큼 진행한다.
 * 과열 80·100, 회복 패널티 종료 같은 구간 경계에서 정확히 쪼개 계산하므로
 * 한 번의 큰 전진과 여러 번의 작은 전진이 같은 결과를 낸다.
 */
export function advance(state: GameState, durationMs: number, ctx: AdvanceContext = ONLINE): AdvanceResult {
  const events: EngineEvent[] = [];
  if (!Number.isFinite(durationMs) || durationMs <= 0) return { state, events };

  const normalMult = productionMultiplier(state, 'normal');
  const darkMult = productionMultiplier(state, 'dark');
  const royaltyPerSec = (persona: GameState['activePersona']) => royaltyBreakdown(state, persona).perSec;
  const eff = Math.max(0, ctx.efficiency);

  let t = state.lastSettledAt;
  const end = t + durationMs;
  let heat = state.heat;
  let persona = state.activePersona;
  let coins = state.coins;
  let normal = state.normalRhymes;
  let dark = state.darkRhymes;
  let penaltyUntil = state.recoveryPenaltyUntil;
  let reentry = state.recoveryReentryRequired;

  // 구간 수는 유한하다: 어둠→(80)→(100)→일반 이후에는 일반에서 경계가 하나뿐이다.
  for (let guard = 0; guard < 16 && t < end - EPS; guard++) {
    const remaining = end - t;
    if (persona === 'normal') {
      const penalized = t < penaltyUntil - EPS;
      const seg = penalized ? Math.min(remaining, penaltyUntil - t) : remaining;
      const sec = seg / 1000;
      const rate = P.normalRate * normalMult * (penalized ? P.recoveryPenalty : 1);
      normal += rate * sec * eff;
      coins += royaltyPerSec('normal') * sec * eff;
      heat = Math.max(0, heat - P.heatDownPerSec * sec);
      t += seg;
      continue;
    }

    // 어둠: 과열이 100에 닿아 있으면 즉시 마이크 압수
    if (heat >= P.maxHeat - EPS) {
      persona = 'normal';
      heat = P.maxHeat;
      penaltyUntil = t + P.recoveryMs;
      reentry = true;
      events.push({ type: 'micSeized' });
      continue;
    }
    const hot = heat >= P.hotThreshold - EPS;
    const boundary = hot ? P.maxHeat : P.hotThreshold;
    const toBoundaryMs = ((boundary - heat) / P.heatUpPerSec) * 1000;
    const seg = Math.min(remaining, toBoundaryMs);
    const sec = seg / 1000;
    const rate = (hot ? P.darkHotRate : P.darkRate) * darkMult;
    dark += rate * sec * eff;
    coins += royaltyPerSec('dark') * sec * eff;
    t += seg;
    if (seg >= toBoundaryMs - EPS) {
      heat = boundary;
      if (!hot) {
        events.push({ type: 'heatHigh' });
      } else {
        persona = 'normal';
        penaltyUntil = t + P.recoveryMs;
        reentry = true;
        events.push({ type: 'micSeized' });
      }
    } else {
      heat += P.heatUpPerSec * sec;
    }
  }

  return {
    state: {
      ...state,
      lastSettledAt: end,
      heat,
      activePersona: persona,
      coins: clampResource(coins),
      normalRhymes: clampResource(normal),
      darkRhymes: clampResource(dark),
      recoveryPenaltyUntil: penaltyUntil,
      recoveryReentryRequired: reentry,
    },
    events,
  };
}

/** 기기 시계가 거꾸로 가거나 저장이 조작돼도 잠금·쿨다운이 비정상적으로 길어지지 않게 한다. */
export function clampTimers(state: GameState, now: number): GameState {
  const cap = (until: number, max: number) => (until > now + max ? now + max : until);
  const concerts = { ...state.concerts };
  let changed = false;
  for (const id of Object.keys(concerts) as (keyof typeof concerts)[]) {
    const c = concerts[id];
    const capped = cap(c.cooldownUntil, BALANCE.concert.cooldownMs);
    if (capped !== c.cooldownUntil) {
      concerts[id] = { ...c, cooldownUntil: capped };
      changed = true;
    }
  }
  const lock = cap(state.switchLockedUntil, P.switchLockMs);
  const pen = cap(state.recoveryPenaltyUntil, P.recoveryMs);
  if (!changed && lock === state.switchLockedUntil && pen === state.recoveryPenaltyUntil) return state;
  return { ...state, concerts, switchLockedUntil: lock, recoveryPenaltyUntil: pen };
}

export interface SettleResult {
  state: GameState;
  events: EngineEvent[];
  /** 반영된(보상 지급 대상) 시간. 상한을 넘은 시간은 포함하지 않는다. */
  paidMs: number;
  /** 실제 경과 시간 */
  elapsedMs: number;
  capped: boolean;
}

/** 온라인 틱 정산. 간격이 비정상적으로 길면 호출자가 settleOffline을 써야 한다. */
export function settleOnline(state: GameState, now: number): SettleResult {
  const gap = now - state.lastSettledAt;
  if (!(gap > 0)) {
    // 정지·역행한 시계: 시각만 맞추고 보상은 주지 않는다.
    const synced = gap < 0 ? clampTimers({ ...state, lastSettledAt: now }, now) : state;
    return { state: synced, events: [], paidMs: 0, elapsedMs: 0, capped: false };
  }
  const r = advance(state, gap, ONLINE);
  return { state: r.state, events: r.events, paidMs: gap, elapsedMs: gap, capped: false };
}

/**
 * 오프라인 정산. 앞쪽 2시간만 효율 70%로 지급하고 나머지는 보상 없이 시간만 흘려보낸다.
 * (과열 회복·잠금 해제는 실제 시간 100%.) 정산 후 lastSettledAt은 now가 된다.
 */
export function settleOffline(state: GameState, now: number): SettleResult {
  const gap = Math.max(now - state.lastSettledAt, 0);
  if (gap === 0) return settleOnline(state, now);
  const paid = Math.min(gap, BALANCE.offline.capMs);
  const first = advance(state, paid, OFFLINE);
  const rest = gap - paid;
  const second = rest > 0 ? advance(first.state, rest, { efficiency: 0 }) : { state: first.state, events: [] };
  return {
    state: second.state,
    events: [...first.events, ...second.events],
    paidMs: paid,
    elapsedMs: gap,
    capped: rest > 0,
  };
}

export interface OfflineReport {
  elapsedMs: number;
  paidMs: number;
  capped: boolean;
  coins: number;
  normalRhymes: number;
  darkRhymes: number;
  micSeized: boolean;
  startedPersona: GameState['activePersona'];
}

export function makeReport(before: GameState, r: SettleResult): OfflineReport {
  return {
    elapsedMs: r.elapsedMs,
    paidMs: r.paidMs,
    capped: r.capped,
    coins: r.state.coins - before.coins,
    normalRhymes: r.state.normalRhymes - before.normalRhymes,
    darkRhymes: r.state.darkRhymes - before.darkRhymes,
    micSeized: r.events.some((e) => e.type === 'micSeized'),
    startedPersona: before.activePersona,
  };
}

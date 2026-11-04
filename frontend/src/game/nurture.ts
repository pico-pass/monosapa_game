import { BALANCE, nurtureActionById, nurtureActionsOf, type NurtureActionDef } from './balance';
import {
  conditionOf,
  efficiencyOf,
  gaugesAt,
  isSleeping,
  levelProgress,
  needsCare,
  nurtureBonus,
  nurtureLevel,
  nurtureUnlocked,
  toleranceFactor,
  type GaugeValues,
  type LevelProgress,
  type NurtureBonus,
} from './nurturedata';
import { clampResource, royaltyBreakdown } from './selectors';
import type { CommandResult, Fail, FailReason, GameState, NurtureSide, Persona } from './types';

/*
 * 모노사파 육성 명령. 이미 정산된 상태를 받아 조건을 다시 검사하고 상태를 한 번에 바꾼다(commands.ts와 같은 규칙).
 * 지금 시각은 state.lastSettledAt이다. 게이지는 시간이 흐른 만큼 계산한 값에 행동 효과를 더해 그 시각으로 다시 기록한다.
 */

const N = BALANCE.nurture;
const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });
const MAIN_GAUGE = { feed: 'full', wash: 'clean', play: 'mood', drink: 'mood', fun: 'mood' } as const;

export interface NurtureView {
  persona: Persona;
  side: NurtureSide;
  unlocked: boolean;
  progress: LevelProgress;
  bonus: NurtureBonus;
  gauges: GaugeValues;
  /** 컨디션 0~100 */
  condition: number;
  /** 성장도에 곱해지는 배율 */
  efficiency: number;
  sleeping: boolean;
  sleepLeftMs: number;
  needsCare: boolean;
}

export function nurtureView(s: Pick<GameState, 'nurture' | 'lastSettledAt' | 'fans'>, persona: Persona): NurtureView {
  const side = s.nurture[persona];
  const at = s.lastSettledAt;
  const gauges = gaugesAt(side, persona, at);
  const sleeping = isSleeping(side, at);
  return {
    persona,
    side,
    unlocked: nurtureUnlocked(s.fans),
    progress: levelProgress(side.xp),
    bonus: nurtureBonus(persona, side.xp),
    gauges,
    condition: conditionOf(gauges),
    efficiency: efficiencyOf(gauges),
    sleeping,
    sleepLeftMs: sleeping ? side.sleepUntil - at : 0,
    needsCare: !sleeping && needsCare(gauges),
  };
}

/** 행동 한 번의 코인: 그 자아의 인세/초 × costSecs. 무료 행동은 0이다. */
export function nurtureCost(s: GameState, def: Pick<NurtureActionDef, 'persona' | 'costSecs'>): number {
  if (def.costSecs <= 0) return 0;
  return Math.max(N.minCoins, Math.ceil(royaltyBreakdown(s, def.persona).perSec * def.costSecs));
}

export interface NurturePreview {
  def: NurtureActionDef;
  cost: number;
  /** 컨디션·내성을 반영한 성장도 (지금 하면 얻는 값) */
  xp: number;
  /** 내성 배율 (술·놀기만, 나머지는 1) */
  tolerance: number;
  /** 지금 할 수 없는 이유. 할 수 있으면 null (코인 부족은 따로 본다) */
  blocked: FailReason | null;
}

/** 지금 이 행동을 하면 어떻게 되는지. 코인 부족은 blocked에 넣지 않는다(UI가 따로 보여 준다). */
export function previewNurture(s: GameState, persona: Persona, def: NurtureActionDef): NurturePreview {
  const v = nurtureView(s, persona);
  const level = v.progress.level;
  const tolerance = toleranceFactor(def, level);
  const xp = Math.max(1, Math.round(def.xp * v.efficiency * tolerance));
  let blocked: FailReason | null = null;
  if (!v.unlocked) blocked = 'nurture_locked';
  else if (v.sleeping) blocked = 'sleeping';
  else if (level < def.unlockLevel) blocked = 'level_low';
  else if (def.kind === 'sleep') blocked = v.gauges.tired < N.sleep.minTired ? 'not_sleepy' : null;
  else {
    const main = MAIN_GAUGE[def.kind];
    if ((def.kind === 'play' || def.kind === 'drink' || def.kind === 'fun') && v.gauges.tired > N.tooTired) blocked = 'too_tired';
    else if (v.gauges[main] > N.needBelow) blocked = 'gauge_high';
  }
  return { def, cost: nurtureCost(s, def), xp, tolerance, blocked };
}

export interface NurtureResult {
  xp: number;
  cost: number;
  levelFrom: number;
  levelTo: number;
  diamonds: number;
}

const clampGauge = (v: number): number => Math.min(N.gauge.max, Math.max(0, v));

/** 돌보기: 밥주기·놀아주기·씻겨주기·잠자기, 어둠의 술·놀기를 한 번 한다. */
export function nurtureAct(state: GameState, persona: Persona, actionId: string): CommandResult<NurtureResult> {
  const def = nurtureActionById(actionId);
  if (!def || def.persona !== persona) return fail(state, 'not_found');
  const p = previewNurture(state, persona, def);
  if (p.blocked) return fail(state, p.blocked);
  if (state.coins < p.cost) return fail(state, 'insufficient_coins');

  const side = state.nurture[persona];
  const now = state.lastSettledAt;
  const g = gaugesAt(side, persona, now);
  // 내성은 쾌락(기분)이 오르는 폭에도 걸린다
  const moodDelta = def.mood > 0 ? def.mood * p.tolerance : def.mood;
  const next: NurtureSide = {
    ...side,
    xp: side.xp + p.xp,
    full: clampGauge(g.full + def.full),
    mood: clampGauge(g.mood + moodDelta),
    tired: clampGauge(g.tired + def.tired),
    clean: clampGauge(g.clean + def.clean),
    at: now,
    sleepUntil: def.kind === 'sleep' ? now + N.sleep.ms : side.sleepUntil,
    uses: { ...side.uses, [def.id]: (side.uses[def.id] ?? 0) + 1 },
  };

  const levelFrom = nurtureLevel(side.xp);
  const levelTo = nurtureLevel(next.xp);
  const every = N.diamonds.every;
  const diamonds = (Math.floor(levelTo / every) - Math.floor(levelFrom / every)) * N.diamonds.amount;
  return {
    ok: true,
    state: {
      ...state,
      coins: state.coins - p.cost,
      diamonds: diamonds > 0 ? clampResource(state.diamonds + diamonds) : state.diamonds,
      nurture: { ...state.nurture, [persona]: next },
    },
    xp: p.xp,
    cost: p.cost,
    levelFrom,
    levelTo,
    diamonds,
  };
}

/** 자는 모노사파를 깨운다. 잔 시간만큼은 이미 피로가 풀려 있다. */
export function nurtureWake(state: GameState, persona: Persona): CommandResult {
  if (!nurtureUnlocked(state.fans)) return fail(state, 'nurture_locked');
  const side = state.nurture[persona];
  const now = state.lastSettledAt;
  if (!isSleeping(side, now)) return fail(state, 'not_ready');
  const g = gaugesAt(side, persona, now);
  const next: NurtureSide = { ...side, ...g, at: now, sleepUntil: now };
  return { ok: true, state: { ...state, nurture: { ...state.nurture, [persona]: next } } };
}

/** 지금 열려 있는 행동 목록(레벨이 모자란 단계도 포함, 화면이 잠금으로 보여 준다) */
export const nurtureActions = (persona: Persona): NurtureActionDef[] => nurtureActionsOf(persona);

/** 더보기 알림용: 돌봐 줘야 하는 자아 수 (열리기 전에는 0) */
export function nurtureAlerts(s: Pick<GameState, 'nurture' | 'lastSettledAt' | 'fans'>): number {
  if (!nurtureUnlocked(s.fans)) return 0;
  return (['normal', 'dark'] as const).filter((p) => nurtureView(s, p).needsCare).length;
}

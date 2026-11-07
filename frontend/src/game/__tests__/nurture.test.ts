import { describe, expect, it } from 'vitest';
import { nurtureAlerts, nurtureAct, nurtureCost, nurtureView, nurtureWaitMs, nurtureWake, previewNurture } from '../nurture';
import { BALANCE, DRINK_IDS, FUN_IDS, NURTURE_ACTIONS, NURTURE_TEMP_OPEN, nurtureActionById, nurtureActionsOf } from '../balance';
import { NURTURE_ACTION_TEXT, nurtureFace } from '../content';
import { conditionOf, efficiencyOf, emptyNurtureSide, gaugesAt, levelProgress, levelStepXp, nurtureBonus, nextMilestone, nurtureLevel, nurtureUnlocked, toleranceFactor, topTier, xpForLevel } from '../nurturedata';
import { bonuses } from '../packdata';
import { createInitialState, validateState } from '../persistence';
import { clickGain, fanGainMult, rhymeRate, royaltyBreakdown } from '../selectors';
import { advance } from '../simulation';
import type { GameState, NurtureSide, Persona } from '../types';

const N = BALANCE.nurture;
const HOUR = 3600_000;
const T0 = new Date(2026, 10, 4, 12, 0, 0).getTime();

const base = (patch: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), fans: N.unlockFans, coins: 1e12, diamonds: 0, lastSettledAt: T0, ...patch });
const at = (s: GameState, ms: number): GameState => ({ ...s, lastSettledAt: ms });
const withSide = (s: GameState, persona: Persona, patch: Partial<NurtureSide>): GameState => ({ ...s, nurture: { ...s.nurture, [persona]: { ...s.nurture[persona], ...patch } } });
/** 그 레벨에 막 닿은 성장도 */
const atLevel = (level: number): number => xpForLevel(level);
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok but got ${JSON.stringify((r as { reason?: string }).reason)}`);
  return r as Extract<T, { ok: true }>;
};
const reason = (r: { ok: boolean }): string => (r.ok ? 'ok' : (r as unknown as { reason: string }).reason);

describe('모노사파 육성: 행동표', () => {
  it('술 8단계·놀기 11단계가 사용자가 정한 이름과 순서 그대로다', () => {
    expect(DRINK_IDS.map((id) => NURTURE_ACTION_TEXT[id].name)).toEqual(['카스레몬', '테라', '새로', '참이슬', '참이슬(빨뚜)', '양주', '고량주(96°)', '퍼플드링크']);
    expect(FUN_IDS.map((id) => NURTURE_ACTION_TEXT[id].name)).toEqual(['디스코팡팡', '클럽', '떡치기', '오디', '떨', '브액', 'LSD', '캔디', 'PCP', '펜타닐', '아이스']);
  });

  it('일반은 밥주기·놀아주기·씻겨주기·잠자기 넷뿐이고 어둠에는 밥주기가 없다', () => {
    expect(nurtureActionsOf('normal').map((a) => NURTURE_ACTION_TEXT[a.id].name)).toEqual(['밥주기', '놀아주기', '씻겨주기', '잠자기']);
    const dark = nurtureActionsOf('dark').map((a) => a.kind);
    expect(dark).not.toContain('feed');
    expect(dark).not.toContain('play');
    expect(dark.filter((k) => k === 'drink')).toHaveLength(8);
    expect(dark.filter((k) => k === 'fun')).toHaveLength(11);
  });

  it('모든 행동에 문구가 있고 ID가 겹치지 않으며, 사다리는 위로 갈수록 레벨·코인·성장도·쾌락이 커진다', () => {
    const ids = NURTURE_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(NURTURE_ACTION_TEXT[id], id).toBeTruthy();
    for (const list of [DRINK_IDS, FUN_IDS]) {
      const defs = list.map((id) => nurtureActionById(id)!);
      for (let i = 1; i < defs.length; i++) {
        expect(defs[i].unlockLevel).toBeGreaterThan(defs[i - 1].unlockLevel);
        expect(defs[i].costSecs).toBeGreaterThan(defs[i - 1].costSecs);
        expect(defs[i].xp).toBeGreaterThan(defs[i - 1].xp);
        expect(defs[i].mood).toBeGreaterThan(defs[i - 1].mood);
        expect(defs[i].tired).toBeGreaterThan(defs[i - 1].tired);
        expect(defs[i].tier).toBe(i + 1);
      }
      expect(defs[0].unlockLevel).toBe(1);
      expect(defs[defs.length - 1].unlockLevel).toBeGreaterThan(30);
    }
  });

  it('팬 8만 명부터 열린다', () => {
    expect(N.unlockFans).toBe(80_000);
  });
});

describe('모노사파 육성: 레벨', () => {
  it('성장도 합계로 레벨이 정해지고 최고 레벨이 없다', () => {
    expect(nurtureLevel(0)).toBe(1);
    expect(nurtureLevel(levelStepXp(1) - 1)).toBe(1);
    expect(nurtureLevel(levelStepXp(1))).toBe(2);
    expect(nurtureLevel(xpForLevel(40))).toBe(40);
    // 40레벨 제한을 풀었다: 그 위로도 계속 오른다
    expect(nurtureLevel(xpForLevel(41))).toBe(41);
    expect(nurtureLevel(xpForLevel(100))).toBe(100);
    expect(nurtureLevel(xpForLevel(100) - 1)).toBe(99);
    const p = levelProgress(xpForLevel(5) + 7);
    expect(p).toEqual({ level: 5, into: 7, need: levelStepXp(5) });
    expect(levelProgress(xpForLevel(60)).need).toBe(levelStepXp(60));
    // 필요 성장도는 레벨마다 늘어난다
    expect(levelStepXp(60)).toBeGreaterThan(levelStepXp(40) * 5);
  });

  it('레벨 보너스: 1레벨은 0이고 레벨마다 라임·인세가 늘며 이정표에 팬(일반)·전투력(어둠)이 붙는다', () => {
    expect(nurtureBonus('normal', 0)).toMatchObject({ level: 1, rhyme: 0, coin: 0, extra: 0, vibe: 'fan' });
    const n = nurtureBonus('normal', atLevel(11));
    expect(n.rhyme).toBeCloseTo(10 * N.perLevel.rhyme);
    expect(n.coin).toBeCloseTo(10 * N.perLevel.coin);
    expect(n.extra).toBeCloseTo(0.02);
    const d = nurtureBonus('dark', atLevel(40));
    expect(d.vibe).toBe('power');
    expect(d.extra).toBeCloseTo(N.milestones.dark.steps.reduce((a, x) => a + x.value, 0));
    // 40레벨을 넘으면 10레벨마다 3%씩 더 붙고, 레벨당 라임·인세도 계속 늘어난다
    expect(nurtureBonus('dark', atLevel(49)).extra).toBeCloseTo(d.extra);
    expect(nurtureBonus('dark', atLevel(50)).extra).toBeCloseTo(d.extra + 0.03);
    expect(nurtureBonus('normal', atLevel(80)).extra).toBeCloseTo(d.extra + 4 * 0.03);
    expect(nurtureBonus('normal', atLevel(81)).rhyme).toBeCloseTo(80 * N.perLevel.rhyme);
    expect(nextMilestone('normal', 5)).toEqual({ level: 10, value: 0.02 });
    expect(nextMilestone('normal', 40)).toEqual({ level: 50, value: 0.03 });
    expect(nextMilestone('dark', 57)).toEqual({ level: 60, value: 0.03 });
  });
});

describe('모노사파 육성: 게이지', () => {
  it('돌보기 전에는 시작 값 그대로이고 시간이 흘러도 변하지 않는다', () => {
    const side = emptyNurtureSide();
    expect(gaugesAt(side, 'normal', T0 + 100 * HOUR)).toEqual(N.gauge.start);
  });

  it('깨어 있으면 시간당 정해진 만큼 변하고 0~100에서 멈춘다', () => {
    const side: NurtureSide = { ...emptyNurtureSide(), full: 60, mood: 60, tired: 25, clean: 60, at: T0 };
    const g = gaugesAt(side, 'normal', T0 + 2 * HOUR);
    expect(g.full).toBeCloseTo(60 + 2 * N.awake.normal.full);
    expect(g.mood).toBeCloseTo(60 + 2 * N.awake.normal.mood);
    expect(g.tired).toBeCloseTo(25 + 2 * N.awake.normal.tired);
    expect(g.clean).toBeCloseTo(60 + 2 * N.awake.normal.clean);
    const long = gaugesAt(side, 'normal', T0 + 500 * HOUR);
    expect(long).toEqual({ full: 0, mood: 0, tired: 100, clean: 0 });
  });

  it('어둠은 쾌락지수가 더 빨리 떨어진다', () => {
    const side: NurtureSide = { ...emptyNurtureSide(), at: T0 };
    expect(gaugesAt(side, 'dark', T0 + HOUR).mood).toBeLessThan(gaugesAt(side, 'normal', T0 + HOUR).mood);
  });

  it('자는 동안은 피로가 풀리고 다른 게이지는 느리게 변하며, 깨면 다시 원래대로 변한다', () => {
    const side: NurtureSide = { ...emptyNurtureSide(), full: 60, mood: 60, tired: 90, clean: 60, at: T0, sleepUntil: T0 + 2 * HOUR };
    const mid = gaugesAt(side, 'normal', T0 + HOUR);
    expect(mid.tired).toBeCloseTo(90 - N.sleep.restPerHour);
    expect(mid.full).toBeCloseTo(60 + N.awake.normal.full * N.sleep.decayFactor);
    const woke = gaugesAt(side, 'normal', T0 + 3 * HOUR);
    expect(woke.tired).toBeCloseTo(0 + N.awake.normal.tired); // 2시간 잠 → 0, 1시간 깨어 있음
    expect(woke.full).toBeCloseTo(60 + N.awake.normal.full * N.sleep.decayFactor * 2 + N.awake.normal.full);
  });

  it('컨디션과 성장도 배율: 모두 최고면 최댓값, 모두 바닥이면 최솟값', () => {
    const best = { full: 100, mood: 100, tired: 0, clean: 100 };
    const worst = { full: 0, mood: 0, tired: 100, clean: 0 };
    expect(conditionOf(best)).toBe(100);
    expect(efficiencyOf(best)).toBeCloseTo(N.efficiency.max);
    expect(conditionOf(worst)).toBe(0);
    expect(efficiencyOf(worst)).toBeCloseTo(N.efficiency.min);
  });
});

describe('모노사파 육성: 임시 개방', () => {
  it.runIf(NURTURE_TEMP_OPEN)('팬이 하나도 없어도 돌볼 수 있다', () => {
    const s = base({ fans: 0 });
    expect(nurtureView(s, 'normal').unlocked).toBe(true);
    expect(ok(nurtureAct(withSide(s, 'normal', { full: 10 }), 'normal', 'n-feed')).ok).toBe(true);
  });
});

describe('모노사파 육성: 일반 돌보기', () => {
  it('열림 조건: 팬 8만 명 이상이거나 임시 개방 중일 때', () => {
    expect(nurtureUnlocked(N.unlockFans - 1, false)).toBe(false);
    expect(nurtureUnlocked(N.unlockFans, false)).toBe(true);
    expect(nurtureUnlocked(0, true)).toBe(true);
    expect(nurtureUnlocked(0)).toBe(NURTURE_TEMP_OPEN);
  });

  it.skipIf(NURTURE_TEMP_OPEN)('팬이 8만 명 미만이면 열리지 않는다', () => {
    const s = base({ fans: N.unlockFans - 1 });
    expect(reason(nurtureAct(s, 'normal', 'n-feed'))).toBe('nurture_locked');
    expect(nurtureAlerts(s)).toBe(0);
  });

  it('밥주기: 코인을 내고 포만감이 오르며 성장도가 쌓이고 그 시각으로 게이지가 기록된다', () => {
    let s = base();
    const cost = nurtureCost(s, nurtureActionById('n-feed')!);
    expect(cost).toBeGreaterThanOrEqual(N.minCoins);
    s = withSide(s, 'normal', { full: 20 });
    const r = ok(nurtureAct(s, 'normal', 'n-feed'));
    const side = r.state.nurture.normal;
    expect(r.state.coins).toBe(s.coins - cost);
    expect(side.full).toBeCloseTo(55);
    expect(side.at).toBe(T0);
    expect(side.xp).toBe(r.xp);
    expect(r.xp).toBeGreaterThan(0);
    expect(side.uses['n-feed']).toBe(1);
    // 다른 자아는 게이지·성장도·대기 시간 모두 그대로다
    expect(r.state.nurture.dark).toEqual(s.nurture.dark);
  });

  it('성장도는 컨디션이 좋을수록 많이 쌓인다', () => {
    const good = withSide(base(), 'normal', { full: 40, mood: 100, tired: 0, clean: 100 });
    const bad = withSide(base(), 'normal', { full: 40, mood: 0, tired: 100, clean: 0 });
    expect(ok(nurtureAct(good, 'normal', 'n-feed')).xp).toBeGreaterThan(ok(nurtureAct(bad, 'normal', 'n-feed')).xp);
  });

  it('주 게이지가 높으면 아직 필요 없어서 할 수 없다', () => {
    const s = withSide(base(), 'normal', { full: 90, mood: 95, clean: 95 });
    expect(reason(nurtureAct(s, 'normal', 'n-feed'))).toBe('gauge_high');
    expect(reason(nurtureAct(s, 'normal', 'n-play'))).toBe('gauge_high');
    expect(reason(nurtureAct(s, 'normal', 'n-wash'))).toBe('gauge_high');
  });

  it('놀아주기: 기분이 오르는 대신 피로·청결·포만감이 깎이고, 너무 지치면 못 논다', () => {
    const s = withSide(base(), 'normal', { mood: 30, tired: 10, full: 50, clean: 50 });
    const side = ok(nurtureAct(s, 'normal', 'n-play')).state.nurture.normal;
    expect(side.mood).toBeCloseTo(60);
    expect(side.tired).toBeCloseTo(25);
    expect(side.full).toBeCloseTo(42);
    expect(side.clean).toBeCloseTo(42);
    const tired = withSide(base(), 'normal', { mood: 30, tired: N.tooTired + 1 });
    expect(reason(nurtureAct(tired, 'normal', 'n-play'))).toBe('too_tired');
  });

  it('게이지는 0~100 안에서 자른다', () => {
    const s = withSide(base(), 'normal', { full: 70 });
    expect(ok(nurtureAct(s, 'normal', 'n-feed')).state.nurture.normal.full).toBe(100);
    const low = withSide(base(), 'normal', { mood: 70, full: 2, clean: 3 });
    const after = ok(nurtureAct(low, 'normal', 'n-play')).state.nurture.normal;
    expect(after.full).toBe(0);
    expect(after.clean).toBe(0);
  });

  it('코인이 모자라면 아무것도 바뀌지 않는다', () => {
    const s = withSide(base({ coins: 0 }), 'normal', { full: 10 });
    const r = nurtureAct(s, 'normal', 'n-feed');
    expect(reason(r)).toBe('insufficient_coins');
    expect(r.state).toBe(s);
  });

  it('무료 행동(놀아주기·잠자기)은 코인이 없어도 된다', () => {
    const s = withSide(base({ coins: 0 }), 'normal', { mood: 10, tired: 50 });
    expect(ok(nurtureAct(s, 'normal', 'n-play')).cost).toBe(0);
    expect(ok(nurtureAct(s, 'normal', 'n-sleep')).cost).toBe(0);
  });

  it('코인은 그 자아의 인세 몇 초 분량이라 팬이 늘수록 같이 오른다', () => {
    const small = base({ fans: 100_000 });
    const big = base({ fans: 1_000_000 });
    const def = nurtureActionById('n-feed')!;
    expect(nurtureCost(big, def)).toBeGreaterThan(nurtureCost(small, def) * 5);
    expect(nurtureCost(small, def)).toBe(Math.ceil(royaltyBreakdown(small, 'normal').perSec * def.costSecs));
  });

  it('다른 자아의 행동이나 모르는 행동은 not_found', () => {
    expect(reason(nurtureAct(base(), 'normal', 'd-drink1'))).toBe('not_found');
    expect(reason(nurtureAct(base(), 'dark', 'n-feed'))).toBe('not_found');
    expect(reason(nurtureAct(base(), 'dark', 'zzz'))).toBe('not_found');
  });
});

describe('모노사파 육성: 행동마다 1분에 한 번', () => {
  const needy = (): GameState => withSide(withSide(base(), 'normal', { full: 10, mood: 10, clean: 10 }), 'dark', { mood: 10, full: 10, clean: 10 });

  it('한 행동을 하면 그 행동만 1분 동안 막히고, 정확히 1분이 지나면 다시 된다', () => {
    const s = ok(nurtureAct(needy(), 'normal', 'n-feed')).state;
    expect(N.cooldownMs).toBe(60_000);
    expect(nurtureWaitMs(s, 'normal', 'n-feed')).toBe(60_000);
    expect(reason(nurtureAct(s, 'normal', 'n-feed'))).toBe('care_cooldown');
    expect(reason(nurtureAct(at(s, T0 + 59_999), 'normal', 'n-feed'))).toBe('care_cooldown');
    expect(nurtureWaitMs(at(s, T0 + 20_000), 'normal', 'n-feed')).toBe(40_000);
    expect(ok(nurtureAct(at(s, T0 + 60_000), 'normal', 'n-feed')).ok).toBe(true);
  });

  it('다른 행동은 바로 이어서 할 수 있고 대기 시간도 서로 따로 센다', () => {
    let s = ok(nurtureAct(needy(), 'normal', 'n-feed')).state;
    expect(nurtureWaitMs(s, 'normal', 'n-play')).toBe(0);
    expect(nurtureWaitMs(s, 'normal', 'n-wash')).toBe(0);
    expect(previewNurture(s, 'normal', nurtureActionById('n-play')!).blocked).toBeNull();
    s = ok(nurtureAct(at(s, T0 + 10_000), 'normal', 'n-play')).state;
    s = ok(nurtureAct(at(s, T0 + 20_000), 'normal', 'n-wash')).state;
    // 먼저 한 행동부터 차례로 풀린다
    expect(nurtureWaitMs(s, 'normal', 'n-feed')).toBe(40_000);
    expect(nurtureWaitMs(s, 'normal', 'n-play')).toBe(50_000);
    expect(nurtureWaitMs(s, 'normal', 'n-wash')).toBe(60_000);
    expect(reason(nurtureAct(s, 'normal', 'n-feed'))).toBe('care_cooldown');
    const later = withSide(at(s, T0 + 60_000), 'normal', { full: 10 });
    expect(previewNurture(later, 'normal', nurtureActionById('n-feed')!).blocked).toBeNull();
    expect(previewNurture(later, 'normal', nurtureActionById('n-play')!).waitMs).toBe(10_000);
  });

  it('어둠은 술 단계마다 대기 시간이 따로고 일반과도 섞이지 않는다', () => {
    let s = ok(nurtureAct(needy(), 'dark', 'd-drink1')).state;
    expect(reason(nurtureAct(s, 'dark', 'd-drink1'))).toBe('care_cooldown');
    expect(nurtureWaitMs(s, 'dark', 'd-wash')).toBe(0);
    expect(nurtureWaitMs(s, 'normal', 'n-feed')).toBe(0);
    s = ok(nurtureAct(at(s, T0 + 5_000), 'dark', 'd-wash')).state;
    expect(nurtureWaitMs(s, 'dark', 'd-drink1')).toBe(55_000);
    expect(nurtureWaitMs(s, 'dark', 'd-wash')).toBe(60_000);
  });

  it('실패한 시도는 대기 시간을 쓰지 않고, 깨우기는 대기 중에도 된다', () => {
    const s = needy();
    expect(reason(nurtureAct(withSide(s, 'normal', { full: 95 }), 'normal', 'n-feed'))).toBe('gauge_high');
    expect(nurtureWaitMs(s, 'normal', 'n-feed')).toBe(0);
    const slept = ok(nurtureAct(withSide(s, 'normal', { tired: 80 }), 'normal', 'n-sleep')).state;
    expect(nurtureWaitMs(slept, 'normal', 'n-sleep')).toBe(60_000);
    expect(ok(nurtureWake(at(slept, T0 + 10_000), 'normal')).ok).toBe(true);
  });

  it('지난 대기 기록은 정리되고, 비정상으로 큰 대기 값도 1분을 넘지 않는다', () => {
    let s = ok(nurtureAct(needy(), 'normal', 'n-feed')).state;
    s = ok(nurtureAct(at(s, T0 + 70_000), 'normal', 'n-play')).state;
    expect(Object.keys(s.nurture.normal.readyAt)).toEqual(['n-play']);
    const tampered = withSide(s, 'dark', { readyAt: { 'd-wash': T0 + 1e12 } });
    expect(nurtureWaitMs(tampered, 'dark', 'd-wash')).toBe(60_000);
  });

  it('다른 이유로 못 하는 행동은 그 이유가 먼저 보인다', () => {
    const s = ok(nurtureAct(withSide(needy(), 'normal', { mood: 95 }), 'normal', 'n-feed')).state;
    expect(previewNurture(s, 'normal', nurtureActionById('n-play')!).blocked).toBe('gauge_high');
    expect(previewNurture(withSide(s, 'normal', { sleepUntil: T0 + 1000, at: T0 }), 'normal', nurtureActionById('n-feed')!).blocked).toBe('sleeping');
  });
});

describe('모노사파 육성: 잠자기', () => {
  it('졸리지 않으면 잘 수 없고, 자는 동안은 다른 행동을 못 한다', () => {
    expect(reason(nurtureAct(base(), 'normal', 'n-sleep'))).toBe('not_sleepy');
    const s = withSide(base(), 'normal', { tired: 80, mood: 20, full: 20 });
    const slept = ok(nurtureAct(s, 'normal', 'n-sleep')).state;
    expect(slept.nurture.normal.sleepUntil).toBe(T0 + N.sleep.ms);
    expect(nurtureView(slept, 'normal').sleeping).toBe(true);
    expect(reason(nurtureAct(slept, 'normal', 'n-feed'))).toBe('sleeping');
    expect(reason(nurtureAct(slept, 'normal', 'n-sleep'))).toBe('sleeping');
    // 다른 자아는 따로 움직인다
    expect(reason(nurtureAct(slept, 'dark', 'd-sleep'))).toBe('not_sleepy');
  });

  it('두 시간이 지나면 저절로 깨고 피로가 풀려 있다', () => {
    const s = withSide(base(), 'normal', { tired: 80, mood: 20, full: 20 });
    const slept = ok(nurtureAct(s, 'normal', 'n-sleep')).state;
    const later = at(slept, T0 + N.sleep.ms + 1);
    const v = nurtureView(later, 'normal');
    expect(v.sleeping).toBe(false);
    expect(v.gauges.tired).toBeLessThan(5);
    expect(ok(nurtureAct(later, 'normal', 'n-feed')).state.nurture.normal.full).toBeGreaterThan(v.gauges.full);
  });

  it('깨우기: 잔 시간만큼만 피로가 풀리고 바로 행동할 수 있다', () => {
    const s = withSide(base(), 'normal', { tired: 80, mood: 20, full: 20 });
    const slept = ok(nurtureAct(s, 'normal', 'n-sleep')).state;
    const woke = ok(nurtureWake(at(slept, T0 + HOUR), 'normal')).state;
    expect(nurtureView(woke, 'normal').sleeping).toBe(false);
    expect(woke.nurture.normal.tired).toBeCloseTo(80 - N.sleep.restPerHour);
    expect(reason(nurtureWake(woke, 'normal'))).toBe('not_ready');
    expect(ok(nurtureAct(woke, 'normal', 'n-feed')).ok).toBe(true);
  });
});

describe('모노사파 육성: 어둠 사다리', () => {
  const darkAt = (level: number, patch: Partial<NurtureSide> = {}): GameState => withSide(base(), 'dark', { xp: atLevel(level), mood: 20, full: 20, tired: 10, clean: 80, ...patch });

  it('술: 포만감이 조금 차고 쾌락이 오르며 피로·청결이 깎인다', () => {
    const s = darkAt(1);
    const r = ok(nurtureAct(s, 'dark', 'd-drink1'));
    const side = r.state.nurture.dark;
    expect(side.full).toBeCloseTo(38);
    expect(side.mood).toBeCloseTo(34);
    expect(side.tired).toBeCloseTo(13);
    expect(side.clean).toBeCloseTo(79);
  });

  it('높은 단계는 레벨이 모자라면 잠겨 있고, 레벨이 되면 열린다', () => {
    expect(reason(nurtureAct(darkAt(1), 'dark', 'd-drink2'))).toBe('level_low');
    expect(reason(nurtureAct(darkAt(2), 'dark', 'd-drink2'))).toBe('level_low');
    expect(ok(nurtureAct(darkAt(3), 'dark', 'd-drink2')).ok).toBe(true);
    expect(reason(nurtureAct(darkAt(37), 'dark', 'd-fun11'))).toBe('level_low');
    expect(ok(nurtureAct(darkAt(38), 'dark', 'd-fun11')).ok).toBe(true);
  });

  it('센 단계일수록 쾌락은 크지만 코인·피로·청결 피해도 크다', () => {
    const lo = ok(nurtureAct(darkAt(38), 'dark', 'd-fun1'));
    const hi = ok(nurtureAct(darkAt(38), 'dark', 'd-fun11'));
    expect(hi.cost).toBeGreaterThan(lo.cost * 10);
    expect(hi.state.nurture.dark.mood).toBeGreaterThan(lo.state.nurture.dark.mood);
    expect(hi.state.nurture.dark.tired).toBeGreaterThan(lo.state.nurture.dark.tired);
    expect(hi.state.nurture.dark.clean).toBeLessThan(lo.state.nurture.dark.clean);
  });

  it('내성: 더 센 단계가 열려 있으면 낮은 단계의 쾌락과 성장도가 줄고, 가장 센 단계는 그대로다', () => {
    const low = darkAt(1);
    const high = darkAt(20);
    const def = nurtureActionById('d-drink1')!;
    expect(previewNurture(low, 'dark', def).tolerance).toBe(1);
    expect(topTier('dark', 'drink', 20)).toBe(6);
    const f = toleranceFactor(def, 20);
    expect(f).toBeCloseTo(N.tolerance.perTier ** 5);
    expect(previewNurture(high, 'dark', def).xp).toBeLessThan(previewNurture(low, 'dark', def).xp);
    expect(ok(nurtureAct(high, 'dark', 'd-drink1')).state.nurture.dark.mood).toBeLessThan(ok(nurtureAct(low, 'dark', 'd-drink1')).state.nurture.dark.mood);
    // 아주 큰 격차에서도 바닥(tolerance.min) 밑으로 내려가지 않는다
    expect(toleranceFactor(nurtureActionById('d-fun1')!, 60)).toBeGreaterThanOrEqual(N.tolerance.min);
    expect(toleranceFactor(nurtureActionById('d-fun11')!, 60)).toBe(1);
  });

  it('쾌락이 높거나 너무 지쳤으면 술도 놀기도 못 한다', () => {
    expect(reason(nurtureAct(darkAt(1, { mood: 95 }), 'dark', 'd-drink1'))).toBe('gauge_high');
    expect(reason(nurtureAct(darkAt(5, { tired: 95 }), 'dark', 'd-fun2'))).toBe('too_tired');
  });

  it('어둠 씻겨주기와 잠자기는 일반처럼 쓴다', () => {
    const s = darkAt(1, { clean: 10, tired: 70 });
    expect(ok(nurtureAct(s, 'dark', 'd-wash')).state.nurture.dark.clean).toBeCloseTo(60);
    expect(ok(nurtureAct(s, 'dark', 'd-sleep')).state.nurture.dark.sleepUntil).toBe(T0 + N.sleep.ms);
  });
});

describe('모노사파 육성: 레벨업 보상', () => {
  it('레벨이 오르면 알려 주고, diamonds.every 레벨을 넘을 때마다 다이아를 준다', () => {
    const need = xpForLevel(5);
    // Lv4 직전에서 한 번 하면 Lv5가 된다
    const s = withSide(base(), 'normal', { xp: need - 1, full: 10, mood: 100, tired: 0, clean: 100 });
    const r = ok(nurtureAct(s, 'normal', 'n-feed'));
    expect(r.levelFrom).toBe(4);
    expect(r.levelTo).toBe(5);
    expect(r.diamonds).toBe(N.diamonds.amount);
    expect(r.state.diamonds).toBe(N.diamonds.amount);
    // 같은 레벨 안에서는 주지 않는다
    const again = ok(nurtureAct(at(withSide(r.state, 'normal', { full: 10 }), T0 + N.cooldownMs), 'normal', 'n-feed'));
    expect(again.diamonds).toBe(0);
  });
});

describe('모노사파 육성: 본 게임 효과', () => {
  it('처음에는 아무 보너스도 없어 기존 수치가 그대로다', () => {
    const s = base();
    const b = bonuses(s);
    expect(b.rhyme).toEqual({ normal: 0, dark: 0 });
    expect(b.coinBy).toEqual({ normal: 0, dark: 0 });
  });

  it('일반 레벨은 일반 라임·인세·작업하기를, 어둠 레벨은 어둠 쪽만 올린다', () => {
    const s = base();
    const lv = withSide(s, 'normal', { xp: atLevel(21) });
    expect(rhymeRate(lv, 'normal')).toBeCloseTo(rhymeRate(s, 'normal') * (1 + 20 * N.perLevel.rhyme));
    expect(rhymeRate(lv, 'dark')).toBeCloseTo(rhymeRate(s, 'dark'));
    expect(royaltyBreakdown(lv, 'normal').perSec).toBeCloseTo(royaltyBreakdown(s, 'normal').perSec * (1 + 20 * N.perLevel.coin));
    expect(royaltyBreakdown(lv, 'dark').perSec).toBeCloseTo(royaltyBreakdown(s, 'dark').perSec);
    expect(clickGain(lv, 'normal')).toBeGreaterThan(clickGain(s, 'normal'));
    expect(clickGain(lv, 'dark')).toBeCloseTo(clickGain(s, 'dark'));
  });

  it('시간이 흐르면 실제 라임·코인이 레벨만큼 더 쌓인다', () => {
    const s = at(base(), T0);
    const lv = withSide(s, 'dark', { xp: atLevel(31) });
    const dark = (x: GameState): GameState => ({ ...x, activePersona: 'dark' });
    const a = advance(dark(s), 60_000).state;
    const b = advance(dark(lv), 60_000).state;
    expect(b.darkRhymes / a.darkRhymes).toBeCloseTo(1 + 30 * N.perLevel.rhyme, 5);
    expect(b.coins - lv.coins).toBeGreaterThan(a.coins - s.coins);
  });

  it('이정표 레벨은 일반이 팬 획득을, 어둠이 전투력을 올린다', () => {
    const s = base();
    const n10 = withSide(s, 'normal', { xp: atLevel(10) });
    const d10 = withSide(s, 'dark', { xp: atLevel(10) });
    expect(fanGainMult(n10)).toBeGreaterThan(fanGainMult(s));
    expect(bonuses(n10).power).toBe(0);
    expect(bonuses(d10).power).toBeCloseTo(0.02);
    expect(bonuses(d10).fan).toBe(0);
  });
});

describe('모노사파 육성: 저장', () => {
  const roundTrip = (s: GameState): GameState => {
    const v = validateState(JSON.parse(JSON.stringify(s)));
    if (!v.ok) throw new Error(v.error);
    return v.state;
  };

  it('새 게임에는 육성 상태가 있고 저장·불러오기를 거쳐도 그대로다', () => {
    let s = withSide(base(), 'normal', { full: 20 });
    s = ok(nurtureAct(s, 'normal', 'n-feed')).state;
    s = withSide(s, 'dark', { xp: atLevel(8), mood: 10 });
    s = ok(nurtureAct(at(s, T0 + N.cooldownMs), 'dark', 'd-drink3')).state;
    const back = roundTrip(s);
    expect(back.nurture).toEqual(s.nurture);
    expect(createInitialState(T0).nurture.normal).toEqual(emptyNurtureSide());
  });

  it('육성이 없던 예전 저장도 시작 값으로 읽는다', () => {
    const raw = JSON.parse(JSON.stringify(createInitialState(T0))) as Record<string, unknown>;
    delete raw.nurture;
    const v = validateState(raw);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.state.nurture.dark).toEqual(emptyNurtureSide());
  });

  it('1분 제한 시각이 없던 예전 저장과 자아마다 숫자 하나이던 저장은 바로 돌볼 수 있다', () => {
    const raw = JSON.parse(JSON.stringify(createInitialState(T0))) as { nurture: Record<Persona, Record<string, unknown>> };
    delete raw.nurture.normal.readyAt;
    const v = validateState(raw);
    expect(v.ok && v.state.nurture.normal.readyAt).toEqual({});
    raw.nurture.dark.readyAt = T0 + 30_000;
    const old = validateState(raw);
    expect(old.ok && old.state.nurture.dark.readyAt).toEqual({});
  });

  it('행동별 대기 시각을 저장하고 읽으며, 모르는 행동은 버리고 음수·문자는 거절한다', () => {
    const raw = JSON.parse(JSON.stringify(createInitialState(T0))) as { nurture: Record<Persona, Record<string, unknown>> };
    raw.nurture.dark.readyAt = { 'd-wash': T0 + 30_000, 'n-feed': T0 + 1, zzz: T0 + 1 };
    const v = validateState(raw);
    expect(v.ok && v.state.nurture.dark.readyAt).toEqual({ 'd-wash': T0 + 30_000 });
    raw.nurture.dark.readyAt = { 'd-wash': -1 };
    expect(validateState(raw).ok).toBe(false);
    raw.nurture.dark.readyAt = { 'd-wash': 'soon' };
    expect(validateState(raw).ok).toBe(false);
    raw.nurture.dark.readyAt = 'x';
    expect(validateState(raw).ok).toBe(false);
  });

  it('범위를 벗어났거나 고쳐진 값은 거절한다', () => {
    const mutate = (fn: (n: Record<Persona, Record<string, unknown>>) => void): boolean => {
      const raw = JSON.parse(JSON.stringify(createInitialState(T0))) as { nurture: Record<Persona, Record<string, unknown>> };
      fn(raw.nurture);
      return validateState(raw).ok;
    };
    expect(mutate(() => {})).toBe(true);
    expect(mutate((n) => (n.normal.full = 101))).toBe(false);
    expect(mutate((n) => (n.dark.tired = -1))).toBe(false);
    expect(mutate((n) => (n.normal.xp = 1.5))).toBe(false);
    expect(mutate((n) => (n.dark.at = 'x'))).toBe(false);
    expect(mutate((n) => (n.dark.uses = { 'd-drink1': -2 }))).toBe(false);
  });

  it('자는 시간은 한 번에 정해진 만큼까지만 인정하고, 다른 자아의 행동 기록은 버린다', () => {
    const raw = JSON.parse(JSON.stringify(createInitialState(T0))) as { nurture: Record<Persona, Record<string, unknown>> };
    raw.nurture.normal.at = T0;
    raw.nurture.normal.sleepUntil = T0 + 999 * HOUR;
    raw.nurture.normal.uses = { 'n-feed': 3, 'd-drink1': 9, 'zzz': 1 };
    const v = validateState(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.state.nurture.normal.sleepUntil).toBe(T0 + N.sleep.ms);
    expect(v.state.nurture.normal.uses).toEqual({ 'n-feed': 3 });
  });
});

describe('모노사파 육성: 알림과 얼굴', () => {
  it('열린 뒤 방치해 바닥이 되면 알림이 켜지고, 돌보면 꺼진다', () => {
    const s = base();
    expect(nurtureAlerts(s)).toBe(0);
    const neglected = withSide(withSide(s, 'normal', { at: T0 }), 'dark', { at: T0 });
    const later = at(neglected, T0 + 24 * HOUR);
    expect(nurtureAlerts(later)).toBe(2);
    // 자는 중에는 알리지 않는다
    expect(nurtureView(withSide(later, 'dark', { sleepUntil: T0 + 25 * HOUR }), 'dark').needsCare).toBe(false);
  });

  it('상태에 맞는 얼굴이 나온다', () => {
    expect(nurtureFace('normal', { sleeping: true, condition: 90 }).icon).toBe('😴');
    expect(nurtureFace('normal', { sleeping: false, condition: 90 }).icon).toBe('😊');
    expect(nurtureFace('dark', { sleeping: false, condition: 10 }).icon).toBe('🥴');
  });
});

/** 하루 세 번 들러 허용되는 행동 중 성장도가 큰 것부터 하는 봇으로 성장 속도를 잰다 */
function casualDays(persona: Persona, days: number): { reached: Record<number, number>; final: number } {
  let s = base();
  const reached: Record<number, number> = {};
  const defs = nurtureActionsOf(persona);
  for (let d = 0; d < days; d++) {
    for (const h of [9, 15, 22]) {
      const visit = T0 + d * 24 * HOUR + h * HOUR;
      // 한 번 들르면 10분쯤 머물고, 행동은 1분에 한 번씩 할 수 있다
      for (let k = 0; k < 10; k++) {
        s = at(s, visit + k * 60_000);
        const v = nurtureView(s, persona);
        const sleep = defs.find((x) => x.kind === 'sleep')!;
        const canSleep = previewNurture(s, persona, sleep).blocked === null;
        const cand = defs.map((x) => previewNurture(s, persona, x)).filter((p) => p.blocked === null && p.def.kind !== 'sleep').sort((a, b) => b.xp - a.xp);
        const pick = canSleep && (v.gauges.tired >= 60 || cand.length === 0) ? sleep.id : cand[0]?.def.id;
        if (!pick) break;
        const r = nurtureAct(s, persona, pick);
        if (!r.ok) break;
        s = r.state;
        if (pick === sleep.id) break;
      }
      const L = nurtureView(s, persona).progress.level;
      for (const t of [10, 20, 30, 40]) if (L >= t && reached[t] === undefined) reached[t] = d + h / 24;
    }
  }
  return { reached, final: nurtureView(s, persona).progress.level };
}

describe('모노사파 육성: 성장 속도', () => {
  it('하루 세 번 들르면 Lv10은 며칠 안에, 만렙은 두 달 안팎에 닿는다 (일반·어둠 모두)', () => {
    for (const persona of ['normal', 'dark'] as const) {
      const { reached } = casualDays(persona, 100);
      expect(reached[10], `${persona} Lv10`).toBeLessThan(5);
      expect(reached[20], `${persona} Lv20`).toBeLessThan(16);
      expect(reached[40], `${persona} Lv40`).toBeGreaterThan(45);
      expect(reached[40], `${persona} Lv40`).toBeLessThan(95);
    }
  });
});

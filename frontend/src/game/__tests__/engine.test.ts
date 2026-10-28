import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance';
import { advance, makeReport, OFFLINE, ONLINE, settleOffline, settleOnline } from '../simulation';
import { createInitialState } from '../persistence';
import { productionMultiplier, rhymeRate, royaltyRate, playerLevel, switchStatus } from '../selectors';
import { switchPersona } from '../commands';
import type { GameState } from '../types';

const T0 = 1_700_000_000_000;
const sec = (n: number) => n * 1000;

function base(over: Partial<GameState> = {}): GameState {
  return { ...createInitialState(T0), ...over };
}

describe('기획서 14장 검증 1~3: 자동 생산·과열 구간', () => {
  it('1) 일반 60초 → 일반 라임 60 (장비·보정 없음)', () => {
    const r = advance(base(), sec(60));
    expect(r.state.normalRhymes).toBeCloseTo(60, 6);
    expect(r.state.darkRhymes).toBe(0);
    expect(r.state.heat).toBe(0);
    expect(r.state.lastSettledAt).toBe(T0 + sec(60));
  });

  it('2) 어둠 G=0에서 100초 → 어둠 라임 170, G=60', () => {
    const r = advance(base({ activePersona: 'dark', heat: 0 }), sec(100));
    expect(r.state.darkRhymes).toBeCloseTo(170, 6);
    expect(r.state.heat).toBeCloseTo(60, 6);
    expect(r.state.activePersona).toBe('dark');
  });

  it('3) 어둠 G=70에서 60초 → 80 경계 → 100 자동 전환 → 일반 회복', () => {
    const r = advance(base({ activePersona: 'dark', heat: 70 }), sec(60));
    // 70→80: 16.667초 × 1.7, 80→100: 33.333초 × 2.1
    expect(r.state.darkRhymes).toBeCloseTo((10 / 0.6) * 1.7 + (20 / 0.6) * 2.1, 6);
    // 이후 10초는 일반 회복: 패널티 50% → 5개, 과열 100→90
    expect(r.state.normalRhymes).toBeCloseTo(5, 6);
    expect(r.state.heat).toBeCloseTo(90, 6);
    expect(r.state.activePersona).toBe('normal');
    expect(r.state.recoveryReentryRequired).toBe(true);
    expect(r.events.map((e) => e.type)).toEqual(['heatHigh', 'micSeized']);
  });

  it('3) 60회 1초 전진 = 한 번의 60초 전진', () => {
    const start = base({ activePersona: 'dark', heat: 70, fans: 150, equipment: { mic: 2, studio: 1, promotion: 1 } });
    const once = advance(start, sec(60)).state;
    let step = start;
    for (let i = 0; i < 60; i++) step = advance(step, sec(1)).state;
    for (const k of ['darkRhymes', 'normalRhymes', 'coins', 'heat'] as const) {
      expect(step[k]).toBeCloseTo(once[k], 6);
    }
    expect(step.activePersona).toBe(once.activePersona);
    expect(step.recoveryPenaltyUntil).toBeCloseTo(once.recoveryPenaltyUntil, 6);
  });

  it('임의로 쪼갠 전진도 한 번의 전진과 같다', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 40; trial++) {
      const start = base({
        activePersona: rnd() < 0.5 ? 'dark' : 'normal',
        heat: rnd() * 100,
        fans: Math.floor(rnd() * 500),
        equipment: { mic: Math.floor(rnd() * 8), studio: Math.floor(rnd() * 8), promotion: Math.floor(rnd() * 8) },
      });
      const total = sec(5 + rnd() * 400);
      const once = advance(start, total).state;
      let rest = total;
      let step = start;
      while (rest > 0) {
        const d = Math.min(rest, sec(0.01 + rnd() * 30));
        step = advance(step, d).state;
        rest -= d;
      }
      for (const k of ['darkRhymes', 'normalRhymes', 'coins', 'heat'] as const) {
        expect(step[k]).toBeCloseTo(once[k], 4);
      }
      expect(step.activePersona).toBe(once.activePersona);
    }
  });

  it('G=80 정확히에서는 2.1/초', () => {
    const r = advance(base({ activePersona: 'dark', heat: 80 }), sec(10));
    expect(r.state.darkRhymes).toBeCloseTo(21, 6);
  });

  it('일반에서는 G가 0까지 식고, 0이어도 생산은 멈추지 않는다', () => {
    const r = advance(base({ heat: 30 }), sec(100));
    expect(r.state.heat).toBe(0);
    expect(r.state.normalRhymes).toBeCloseTo(100, 6);
  });

  it('장비 배율: P = 1 + 0.15×마이크 + 0.05×작업실, 속성마다 자기 장비만 쓴다', () => {
    const s = base({ equipment: { mic: 4, studio: 3, promotion: 0 }, darkEquipment: { mic: 2, studio: 0, promotion: 0 } });
    expect(productionMultiplier(s, 'normal')).toBeCloseTo(1.75, 9);
    expect(productionMultiplier(s, 'dark')).toBeCloseTo(1.3, 9);
    expect(rhymeRate(s, 'normal')).toBeCloseTo(1.75, 9);
    // 어둠 생산은 어둠속성 장비만 곱한다 (일반 장비는 무관)
    expect(rhymeRate({ ...s, heat: 10 }, 'dark')).toBeCloseTo(1.7 * 1.3, 9);
    expect(rhymeRate({ ...s, heat: 85 }, 'dark')).toBeCloseTo(2.1 * 1.3, 9);
  });

  it('일반 장비는 일반속성에서만, 어둠 장비는 어둠속성에서만 적용된다 (자동 생산·인세 정산)', () => {
    const bare = base({ fans: 100 });
    const normalGear = { ...bare, equipment: { mic: 4, studio: 3, promotion: 5 } };
    const darkGear = { ...bare, darkEquipment: { mic: 4, studio: 3, promotion: 5 } };
    const run = (s: GameState, persona: 'normal' | 'dark') => advance({ ...s, activePersona: persona }, sec(20)).state;

    // 일반 장비: 일반에서는 배율(P=1.75)·홍보(×2), 어둠에서는 아무 효과 없음
    expect(run(normalGear, 'normal').normalRhymes).toBeCloseTo(run(bare, 'normal').normalRhymes * 1.75, 9);
    expect(run(normalGear, 'normal').coins).toBeCloseTo(run(bare, 'normal').coins * 2, 9);
    expect(run(normalGear, 'dark').darkRhymes).toBeCloseTo(run(bare, 'dark').darkRhymes, 9);
    expect(run(normalGear, 'dark').coins).toBeCloseTo(run(bare, 'dark').coins, 9);

    // 어둠 장비: 어둠에서는 배율·홍보가 적용되고, 일반에서는 아무 효과 없음
    expect(run(darkGear, 'dark').darkRhymes).toBeCloseTo(run(bare, 'dark').darkRhymes * 1.75, 9);
    expect(run(darkGear, 'dark').coins).toBeCloseTo(run(bare, 'dark').coins * 2, 9);
    expect(run(darkGear, 'normal').normalRhymes).toBeCloseTo(run(bare, 'normal').normalRhymes, 9);
    expect(run(darkGear, 'normal').coins).toBeCloseTo(run(bare, 'normal').coins, 9);
  });

  it('인세 공식과 자아 배율', () => {
    const s = base({ fans: 100, albums: [{ id: 'a', title: 't', type: 'normal', releasedAt: 0 }] });
    const withPromo = { ...s, equipment: { mic: 0, studio: 0, promotion: 5 }, darkEquipment: { mic: 0, studio: 0, promotion: 0 } };
    // 앨범 3장: 인세 배율 +8% → +10% → +12%가 누적(1.08, 1.18, 1.30)
    const alb = (n: number) => ({ ...withPromo, albums: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, title: 't', type: 'normal' as const, releasedAt: 0 })) });
    // 일반 홍보(×2)는 어둠 인세에 곱해지지 않는다. 어둠 인세에는 어둠 홍보만 곱해진다.
    expect(royaltyRate(alb(2), 'dark')).toBeCloseTo(100 * 0.02 * 1.18, 9);
    expect(royaltyRate(alb(3), 'dark')).toBeCloseTo(100 * 0.02 * 1.3, 9);
    expect(royaltyRate(withPromo, 'dark')).toBeCloseTo(100 * 0.02 * 1.08, 9);
    expect(royaltyRate(withPromo, 'normal')).toBeCloseTo(100 * 0.02 * 2 * 1.08 * 1.25, 9);
    const darkPromo = { ...withPromo, darkEquipment: { mic: 0, studio: 0, promotion: 10 } };
    expect(royaltyRate(darkPromo, 'dark')).toBeCloseTo(100 * 0.02 * 3 * 1.08, 9);
    expect(royaltyRate(darkPromo, 'normal')).toBeCloseTo(100 * 0.02 * 2 * 1.08 * 1.25, 9);
    expect(playerLevel(0)).toBe(1);
    expect(playerLevel(20)).toBe(2);
    expect(playerLevel(80)).toBe(3);
  });
});

describe('마이크 압수와 전환 규칙', () => {
  it('압수 후 20초는 일반 50%, 이후 100%', () => {
    const seized = advance(base({ activePersona: 'dark', heat: 99.4 }), sec(2)).state; // 1초 안에 100 도달
    expect(seized.activePersona).toBe('normal');
    const after = advance({ ...seized, normalRhymes: 0 }, sec(40));
    // 남은 압수 시간 동안 50%, 이후 100%
    const penaltyLeft = Math.max(0, (seized.recoveryPenaltyUntil - seized.lastSettledAt) / 1000);
    expect(after.state.normalRhymes).toBeCloseTo(penaltyLeft * 0.5 + (40 - penaltyLeft), 6);
  });

  it('압수는 코인·팬·곡을 차감하지 않는다', () => {
    const start = base({
      activePersona: 'dark',
      heat: 99,
      coins: 500,
      fans: 40,
      singles: [{ id: 's1', persona: 'normal', title: 'x', releasedAt: 0 }],
    });
    const r = advance(start, sec(3)).state;
    expect(r.coins).toBeGreaterThanOrEqual(500);
    expect(r.fans).toBe(40);
    expect(r.singles).toHaveLength(1);
  });

  it('압수 후 재진입: 20초 경과 + G≤60 필요', () => {
    let s = advance(base({ activePersona: 'dark', heat: 99.9 }), sec(1)).state;
    expect(s.activePersona).toBe('normal');
    s = advance(s, sec(25)).state; // 20초 지났지만 G≈75
    expect(switchStatus(s, 'dark').allowed).toBe(false);
    expect(switchPersona(s, 'dark').ok).toBe(false);
    s = advance(s, sec(20)).state; // G≈55
    expect(s.heat).toBeLessThanOrEqual(60);
    const r = switchPersona(s, 'dark');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.recoveryReentryRequired).toBe(false);
  });

  it('수동 전환: 일반→어둠은 G≤80, 전환 직후 3초 재전환 불가, 같은 자아는 무시', () => {
    const hot = base({ heat: 81 });
    expect(switchPersona(hot, 'dark')).toMatchObject({ ok: false, reason: 'heat_too_high' });
    const ok = switchPersona(base({ heat: 80 }), 'dark');
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(switchPersona(ok.state, 'dark')).toMatchObject({ ok: false, reason: 'same_persona' });
    expect(switchPersona(ok.state, 'normal')).toMatchObject({ ok: false, reason: 'switch_lock' });
    const later = advance(ok.state, sec(3)).state;
    expect(switchPersona(later, 'normal').ok).toBe(true);
  });

  it('전환해도 라임·과열 수치는 초기화되지 않는다', () => {
    const s = base({ normalRhymes: 12, darkRhymes: 7, heat: 40 });
    const r = switchPersona(s, 'dark');
    expect(r.ok && r.state.normalRhymes).toBe(12);
    expect(r.ok && r.state.darkRhymes).toBe(7);
    expect(r.ok && r.state.heat).toBe(40);
  });
});

describe('기획서 14장 검증 4~5: 오프라인 정산', () => {
  it('4) 2시간 초과 → 2시간분만, 효율 70%', () => {
    const s = base();
    const r = settleOffline(s, T0 + 20 * 3600 * 1000);
    expect(r.capped).toBe(true);
    expect(r.paidMs).toBe(2 * 3600 * 1000);
    expect(r.state.normalRhymes).toBeCloseTo(2 * 3600 * 0.7, 3);
    expect(r.state.lastSettledAt).toBe(T0 + 20 * 3600 * 1000);
  });

  it('4) 정산 직후 같은 시각으로 다시 정산해도 추가 지급이 없다', () => {
    const now = T0 + 3 * 3600 * 1000;
    const first = settleOffline(base({ fans: 100 }), now);
    const again = settleOffline(first.state, now);
    expect(again.state.coins).toBe(first.state.coins);
    expect(again.state.normalRhymes).toBe(first.state.normalRhymes);
    const online = settleOnline(first.state, now);
    expect(online.state.coins).toBe(first.state.coins);
  });

  it('음수 시간(시계 역행)은 보상 없이 시각만 맞춘다', () => {
    const s = base({ fans: 50 });
    const r = settleOffline(s, T0 - 5000);
    expect(r.state.coins).toBe(0);
    expect(r.state.lastSettledAt).toBe(T0 - 5000);
  });

  it('5) 어둠으로 종료 → 과열 후 일반 전환, 두 라임과 올바른 인세 정산', () => {
    const start = base({ activePersona: 'dark', heat: 0, fans: 100 });
    const r = settleOffline(start, T0 + 3600 * 1000);
    expect(r.state.activePersona).toBe('normal');
    expect(r.state.heat).toBe(0);
    // 어둠 구간: 0→80 (133.33초) + 80→100 (33.33초), 효율 0.7
    const darkSec = 80 / 0.6;
    const hotSec = 20 / 0.6;
    expect(r.state.darkRhymes).toBeCloseTo((darkSec * 1.7 + hotSec * 2.1) * 0.7, 4);
    // 일반 구간: 총 3600 - 166.67초, 압수 20초는 50%
    const normalSec = 3600 - darkSec - hotSec;
    expect(r.state.normalRhymes).toBeCloseTo((20 * 0.5 + (normalSec - 20)) * 0.7, 4);
    const royalty = 100 * 0.02;
    expect(r.state.coins).toBeCloseTo(((darkSec + hotSec) * royalty + normalSec * royalty * 1.25) * 0.7, 4);
    expect(r.events.some((e) => e.type === 'micSeized')).toBe(true);
    const rep = makeReport(start, r);
    expect(rep.micSeized).toBe(true);
    expect(rep.coins).toBeCloseTo(r.state.coins, 6);
  });

  it('오프라인에서도 과열·잠금 경과는 100% 실시간', () => {
    const s = base({ heat: 50 });
    const r = advance(s, sec(30), OFFLINE);
    expect(r.state.heat).toBeCloseTo(20, 6);
    expect(r.state.normalRhymes).toBeCloseTo(30 * 0.7, 6);
  });

  it('온라인 효율은 1', () => {
    expect(ONLINE.efficiency).toBe(1);
    expect(BALANCE.offline.efficiency).toBe(0.7);
  });
});

describe('9) 탭 숨김·복귀의 배경 정산', () => {
  it('숨기기 전 온라인 구간 + 숨긴 동안의 오프라인 구간이 겹치지 않고 한 번씩만 지급된다', () => {
    const start = base({ fans: 100 });
    const online = settleOnline(start, T0 + sec(30)); // 숨기기 직전까지 온라인
    const hidden = settleOffline(online.state, T0 + sec(30) + sec(600)); // 10분 숨김 → 복귀 시 한 번 정산
    expect(hidden.state.normalRhymes).toBeCloseTo(30 + 600 * 0.7, 6);
    expect(hidden.state.coins).toBeCloseTo(100 * 0.02 * 1.25 * (30 + 600 * 0.7), 6);
    // 복귀 직후 온라인 틱이 같은 시간을 또 지급하지 않는다
    const tick = settleOnline(hidden.state, T0 + sec(630));
    expect(tick.state.normalRhymes).toBe(hidden.state.normalRhymes);
  });
});

describe('자원 안전', () => {
  it('거대한 시간·수치에서도 NaN/Infinity가 생기지 않는다', () => {
    const r = advance(base({ fans: 1e14, equipment: { mic: 20, studio: 20, promotion: 20 } }), 1e13);
    for (const k of ['coins', 'normalRhymes', 'darkRhymes', 'heat'] as const) {
      expect(Number.isFinite(r.state[k])).toBe(true);
      expect(r.state[k]).toBeLessThanOrEqual(BALANCE.maxResource);
    }
  });

  it('NaN/음수 duration은 무시', () => {
    const s = base();
    expect(advance(s, NaN).state).toBe(s);
    expect(advance(s, -50).state).toBe(s);
  });
});

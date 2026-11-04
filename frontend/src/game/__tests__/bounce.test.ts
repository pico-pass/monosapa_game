import { describe, expect, it } from 'vitest';
import { BALANCE, manualGameOf } from '../balance';
import {
  BOOM,
  BounceGame,
  CELLS,
  COLS,
  EFFECT_IDS,
  EMPTY,
  FAN,
  MIC,
  MUTE,
  ROWS,
  aimToward,
  tierOfRow,
  type Ball,
  type BounceEvent,
} from '../bounce';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { createInitialState } from '../persistence';

const B = BALANCE.bounce;
const T0 = 1_700_000_000_000;
const DEG = Math.PI / 180;

const at = (r: number, c: number) => r * COLS + c;
/** 객석이 빈 판. 곡 시작 직후라 구슬 발사(450ms)·새 관객(650ms)이 오기 전에 확인할 수 있다. */
function empty(seed = 1, persona: 'normal' | 'dark' = 'normal'): BounceGame {
  const g = new BounceGame(persona, seed);
  g.kind.fill(EMPTY);
  g.hp.fill(0);
  g.events.length = 0;
  return g;
}
const put = (g: BounceGame, r: number, c: number, kind: number, hp: number) => {
  g.kind[at(r, c)] = kind;
  g.hp[at(r, c)] = hp;
};
const ball = (over: Partial<Ball> = {}): Ball => ({ x: 3.5, y: 6.5, vx: 0, vy: -B.ballSpeed, dmg: 1, pierce: 0, echo: 0, split: false, skip: -1, ageMs: 0, ...over });
const eventsOf = <T extends BounceEvent['type']>(g: BounceGame, type: T) => g.events.filter((e): e is Extract<BounceEvent, { type: T }> => e.type === type);
const filled = (g: BounceGame) => Array.from(g.kind).filter((k) => k !== EMPTY).length;
const speedOf = (b: Ball) => Math.hypot(b.vx, b.vy);

describe('판 만들기', () => {
  it('칸 수와 층: 위 3줄이 3층(맨 뒷줄), 아래 3줄이 1층', () => {
    expect(CELLS).toBe(ROWS * COLS);
    expect([0, 1, 2].map(tierOfRow)).toEqual([3, 3, 3]);
    expect([3, 4, 5].map(tierOfRow)).toEqual([2, 2, 2]);
    expect([6, 7, 8].map(tierOfRow)).toEqual([1, 1, 1]);
  });

  it('처음에는 객석이 일부만 차 있고, 모든 관객은 체력이 1 이상이다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const g = new BounceGame(persona, seed);
        const n = filled(g);
        expect(n).toBeGreaterThan(CELLS * 0.2);
        expect(n).toBeLessThan(CELLS * 0.8);
        for (let i = 0; i < CELLS; i++) {
          if (g.kind[i] === EMPTY) expect(g.hp[i]).toBe(0);
          else {
            expect(g.hp[i]).toBeGreaterThanOrEqual(1);
            expect(g.hp[i]).toBeLessThan(40);
          }
        }
      }
    }
  });

  it('뒷층일수록 관객이 단단하다(평균 체력)', () => {
    const avg = [0, 0, 0, 0];
    const cnt = [0, 0, 0, 0];
    for (let seed = 1; seed <= 40; seed++) {
      const g = new BounceGame('normal', seed);
      for (let i = 0; i < CELLS; i++) {
        if (g.kind[i] !== FAN) continue;
        const t = tierOfRow(Math.floor(i / COLS));
        avg[t] += g.hp[i];
        cnt[t] += 1;
      }
    }
    const mean = (t: number) => avg[t] / cnt[t];
    expect(mean(2)).toBeGreaterThan(mean(1));
    expect(mean(3)).toBeGreaterThan(mean(2));
  });

  it('방음벽은 어둠에만 나온다', () => {
    let darkMutes = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const n = new BounceGame('normal', seed);
      expect(Array.from(n.kind).includes(MUTE)).toBe(false);
      darkMutes += Array.from(new BounceGame('dark', seed).kind).filter((k) => k === MUTE).length;
    }
    expect(darkMutes).toBeGreaterThan(0);
  });

  it('같은 씨앗이면 같은 객석, 다른 씨앗이면 다른 객석', () => {
    expect(Array.from(new BounceGame('normal', 5).hp)).toEqual(Array.from(new BounceGame('normal', 5).hp));
    expect(Array.from(new BounceGame('normal', 5).hp)).not.toEqual(Array.from(new BounceGame('normal', 6).hp));
  });
});

describe('조준', () => {
  it('마이크 바로 위를 가리키면 90°, 허용 범위 밖은 잘린다', () => {
    expect(aimToward(MIC.x, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(aimToward(0, MIC.y - 0.01)).toBeCloseTo(B.aimMaxDeg * DEG, 6);
    expect(aimToward(COLS, MIC.y - 0.01)).toBeCloseTo(B.aimMinDeg * DEG, 6);
    expect(aimToward(0, MIC.y + 3)).toBeGreaterThanOrEqual(B.aimMinDeg * DEG);
    expect(aimToward(0, MIC.y + 3)).toBeLessThanOrEqual(B.aimMaxDeg * DEG);
  });

  it('setAim은 허용 범위로 자르고 숫자가 아니면 무시한다', () => {
    const g = new BounceGame('normal', 1);
    g.setAim(0);
    expect(g.aim).toBeCloseTo(B.aimMinDeg * DEG, 9);
    g.setAim(Math.PI);
    expect(g.aim).toBeCloseTo(B.aimMaxDeg * DEG, 9);
    g.setAim(1);
    g.setAim(NaN);
    expect(g.aim).toBe(1);
  });

  it('조준 미리보기: 마이크에서 시작해 처음 부딪히는 곳까지 간다', () => {
    const g = empty();
    put(g, 4, 3, FAN, 5);
    const before = { kind: Array.from(g.kind), hp: Array.from(g.hp) };
    const path = g.aimPath(Math.PI / 2, 1);
    expect(path[0]).toEqual({ x: MIC.x, y: MIC.y });
    expect(path.length).toBe(2);
    // 칸(4,3)의 아래쪽 면(y=5)에 구슬 반지름만큼 못 미쳐 멈춘다
    expect(path[1].x).toBeCloseTo(3.5, 3);
    expect(path[1].y).toBeGreaterThan(5);
    expect(path[1].y).toBeLessThan(5 + B.ballRadius + 0.2);
    // 미리보기는 판을 바꾸지 않는다
    expect({ kind: Array.from(g.kind), hp: Array.from(g.hp) }).toEqual(before);
    expect(g.wavePower[0]).toBe(0);
  });

  it('조준 값 미리 계산: 막힌 곳이 없으면 0, 객석을 맞히면 피해 × 층 배율', () => {
    const g = empty();
    expect(g.projectShot(Math.PI / 2)).toBe(0);
    put(g, 7, 3, FAN, 5); // 1층
    expect(g.projectShot(Math.PI / 2)).toBeGreaterThanOrEqual(B.tierMult[1]);
    const hpBefore = g.hp[at(7, 3)];
    g.projectShot(Math.PI / 2);
    expect(g.hp[at(7, 3)]).toBe(hpBefore);
  });
});

describe('구슬 움직임', () => {
  it('벽에서 튕겨 나오고 칸 밖으로 나가지 않는다', () => {
    const g = empty();
    g.balls = [ball({ x: 0.5, y: 5, vx: -B.ballSpeed, vy: -3 })];
    g.advance(120);
    const b = g.balls[0];
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThanOrEqual(B.ballRadius - 1e-9);
    expect(b.x).toBeLessThanOrEqual(COLS - B.ballRadius + 1e-9);
  });

  it('천장에서 튕겨 내려온다', () => {
    const g = empty();
    g.balls = [ball({ x: 3.5, y: 1, vx: 2, vy: -B.ballSpeed })];
    g.advance(150);
    expect(g.balls[0].vy).toBeGreaterThan(0);
    expect(g.balls[0].y).toBeGreaterThanOrEqual(B.ballRadius - 1e-9);
  });

  it('벽에 부딪힌 뒤에도 세로 속도가 너무 느려지지 않고 속도는 일정하다', () => {
    const g = empty();
    g.balls = [ball({ x: 1, y: 5, vx: -B.ballSpeed, vy: -0.5 })];
    g.advance(100);
    const b = g.balls[0];
    expect(Math.abs(b.vy)).toBeGreaterThanOrEqual(B.ballSpeed * B.minVyRatio - 1e-6);
    expect(speedOf(b)).toBeCloseTo(B.ballSpeed, 5);
  });

  it('바닥에 닿으면 사라지고, 메아리가 있으면 한 번 튕겨 오른다', () => {
    const g = empty();
    g.balls = [ball({ y: 10.3, vy: B.ballSpeed })];
    g.advance(60);
    expect(g.balls.length).toBe(0);

    const e = empty();
    e.balls = [ball({ y: 10.3, vy: B.ballSpeed, echo: 1 })];
    e.advance(60);
    expect(e.balls.length).toBe(1);
    expect(e.balls[0].vy).toBeLessThan(0);
    expect(e.balls[0].echo).toBe(0);
    expect(eventsOf(e, 'echo').length).toBe(1);
  });

  it('오래된 구슬은 사라진다', () => {
    const g = empty();
    g.balls = [ball({ x: 3.5, y: 5, vx: 0, vy: -B.ballSpeed, ageMs: B.ballLifeMs - 10 })];
    g.advance(50);
    expect(g.balls.length).toBe(0);
  });
});

describe('관객 맞히기', () => {
  it('맞으면 체력이 깎이고 구슬은 튕겨 내려오며, 응원은 피해 × 층 배율이다', () => {
    const g = empty();
    put(g, 4, 3, FAN, 3); // 2층
    g.balls = [ball({ y: 6.5 })];
    g.advance(250);
    expect(g.hp[at(4, 3)]).toBe(2);
    expect(g.balls[0].vy).toBeGreaterThan(0);
    expect(g.wavePower[0]).toBeCloseTo(B.tierMult[2], 9);
    expect(eventsOf(g, 'hit')[0]).toMatchObject({ cell: at(4, 3), killed: false });
  });

  it('체력이 0이 되면 관객이 사라지고 깬 수·뒷줄 수가 오른다', () => {
    const g = empty();
    put(g, 1, 3, FAN, 1); // 3층(맨 뒷줄)
    g.balls = [ball({ y: 3.5 })];
    g.advance(200);
    expect(g.kind[at(1, 3)]).toBe(EMPTY);
    expect(g.broken).toBe(1);
    expect(g.back).toBe(1);
    expect(g.wavePower[0]).toBeCloseTo(B.tierMult[3], 9);
    expect(eventsOf(g, 'break')[0]).toMatchObject({ cell: at(1, 3), tier: 3, kind: FAN });
  });

  it('앰프가 있으면 한 번에 더 많이 깎는다(남은 체력보다 더 점수를 주지는 않는다)', () => {
    const g = empty();
    g.effects.amp = 2;
    put(g, 4, 3, FAN, 2);
    g.balls = [ball({ y: 6.5, dmg: g.damage })];
    expect(g.damage).toBe(1 + 2 * B.effects.ampStep);
    g.advance(250);
    expect(g.kind[at(4, 3)]).toBe(EMPTY);
    expect(g.wavePower[0]).toBeCloseTo(2 * B.tierMult[2], 9);
  });

  it('관통: 한 명을 뚫고 지나간 뒤 다음 관객에게 튕긴다', () => {
    const g = empty();
    put(g, 4, 3, FAN, 5);
    put(g, 2, 3, FAN, 5);
    g.balls = [ball({ y: 6.5, pierce: 1 })];
    g.advance(330); // 두 번째 관객에게 튕겨 내려와 첫 관객의 윗면을 다시 때리기 전까지
    expect(g.hp[at(4, 3)]).toBe(4);
    expect(g.hp[at(2, 3)]).toBe(4);
    expect(g.balls[0].pierce).toBe(0);
    expect(g.balls[0].vy).toBeGreaterThan(0);
  });

  it('방음벽: 부서지지 않으면 구슬을 삼키고, 부서지면 구슬은 계속 간다', () => {
    const g = empty();
    put(g, 4, 3, MUTE, 5);
    g.balls = [ball({ y: 6.5 })];
    g.advance(250);
    expect(g.balls.length).toBe(0);
    expect(g.hp[at(4, 3)]).toBe(4);
    expect(eventsOf(g, 'absorb').length).toBe(1);
    // 방음벽은 응원이 절반
    expect(g.wavePower[0]).toBeCloseTo(B.tierMult[2] * B.mute.pointMult, 9);

    const h = empty();
    put(h, 4, 3, MUTE, 1);
    h.balls = [ball({ y: 6.5 })];
    h.advance(250);
    expect(h.kind[at(4, 3)]).toBe(EMPTY);
    expect(h.balls.length).toBe(1);
  });

  it('폭죽 관객: 깨지면 둘레 8칸이 피해를 입고, 터지는 폭죽은 연쇄한다', () => {
    const g = empty();
    put(g, 2, 3, BOOM, 1);
    // 폭죽 바로 아래(3,3)는 구슬이 올라오는 길이라 비워 둔다
    for (const [r, c] of [[1, 2], [1, 3], [1, 4], [2, 2], [2, 4], [3, 2], [3, 4]]) put(g, r, c, FAN, 6);
    put(g, 0, 3, FAN, 6); // 둘레 8칸 밖
    g.balls = [ball({ y: 4.5 })];
    g.advance(150);
    const boomDmg = Math.round(B.boom.damageBase * B.hpGrowth[0]);
    expect(g.booms).toBe(1);
    expect(g.hp[at(1, 3)]).toBe(6 - boomDmg);
    expect(g.hp[at(3, 2)]).toBe(6 - boomDmg);
    expect(g.hp[at(0, 3)]).toBe(6);
    expect(eventsOf(g, 'boom').length).toBe(1);

    const chain = empty();
    put(chain, 2, 3, BOOM, 1);
    put(chain, 2, 4, BOOM, 1);
    put(chain, 2, 5, FAN, 9);
    (chain as unknown as { damageCell(c: number, d: number): void }).damageCell(at(2, 3), 5);
    expect(chain.booms).toBe(2);
    expect(chain.hp[at(2, 5)]).toBe(9 - boomDmg);
  });

  it('분열: 처음 부딪힐 때 확률로 구슬이 둘이 된다', () => {
    let split = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = empty(seed);
      g.effects.split = 3;
      put(g, 4, 3, FAN, 50);
      g.balls = [ball({ y: 6.5, split: true })];
      g.advance(250);
      if (g.balls.length === 2) {
        split += 1;
        const [a, b] = g.balls;
        expect(speedOf(b)).toBeCloseTo(B.ballSpeed, 4);
        expect(b.split).toBe(false);
        expect(Math.abs(a.vx - b.vx) + Math.abs(a.vy - b.vy)).toBeGreaterThan(0.5);
        expect(eventsOf(g, 'split').length).toBe(1);
      }
    }
    expect(split).toBeGreaterThanOrEqual(12);
  });
});

describe('발사와 새 관객', () => {
  it('발사 간격마다 구슬이 나가고, 연사를 고르면 간격이 줄어든다', () => {
    const g = empty();
    g.setAim(60 * DEG);
    g.advance(B.fireMs + 20);
    expect(g.shots).toBe(1);
    expect(g.balls.length).toBe(1);
    expect(g.balls[0].vx).toBeGreaterThan(0);
    expect(g.balls[0].vy).toBeLessThan(0);
    g.effects.rate = 3;
    expect(g.fireIntervalMs).toBeCloseTo(B.fireMs * (1 - B.effects.rateStep) ** 3, 9);
    expect(g.fireIntervalMs).toBeLessThan(B.fireMs);
  });

  it('구슬은 maxBalls를 넘지 않는다', () => {
    const g = empty();
    g.effects.rate = 3;
    g.balls = Array.from({ length: B.maxBalls }, () => ball({ x: 3.5, y: 9.9, vy: -0.01 }));
    g.advance(100);
    expect(g.balls.length).toBeLessThanOrEqual(B.maxBalls);
  });

  it('곡 동안 새 관객이 한 명씩 들어오고, 한도(capFill)를 넘지 않는다', () => {
    const g = empty();
    for (let r = 0; r <= 6; r++) for (let c = 0; c < COLS; c++) put(g, r, c, FAN, 9999);
    expect(filled(g)).toBe(49);
    g.advance(B.refillMs[0] + 10);
    expect(filled(g)).toBe(50);

    const full = empty();
    const cap = Math.floor(CELLS * B.capFill);
    for (let i = 0; i < cap; i++) full.kind[i] = FAN;
    full.hp.fill(9999);
    full.advance(B.refillMs[0] * 2 + 10);
    expect(filled(full)).toBe(cap);
  });
});

describe('곡 진행과 이펙터', () => {
  it('곡이 끝나면 시간이 멈추고 이펙터 3개 중 하나를 고른다', () => {
    const g = new BounceGame('normal', 7);
    g.advance(B.waves[0].ms + 5000); // 곡 길이를 넘겨도 남은 시간까지만 흐른다
    expect(g.status).toBe('picking');
    expect(g.picking).toBe(true);
    expect(g.offers.length).toBe(B.offers);
    expect(new Set(g.offers).size).toBe(B.offers);
    expect(g.elapsedMs).toBe(B.waves[0].ms);
    expect(eventsOf(g, 'waveEnd')[0].index).toBe(0);
    expect(eventsOf(g, 'pick').length).toBe(1);
    const before = g.elapsedMs;
    g.advance(1000);
    expect(g.elapsedMs).toBe(before);
    expect(g.pick(9)).toBe(false);

    const choice = g.offers[1];
    expect(g.pick(1)).toBe(true);
    expect(g.effects[choice]).toBe(1);
    expect(g.status).toBe('running');
    expect(g.waveIdx).toBe(1);
    expect(g.balls.length).toBe(0);
    expect(g.remainingMs).toBe(B.waves[1].ms);
    expect(filled(g)).toBeGreaterThan(0);
    expect(g.pick(0)).toBe(false);
  });

  it('한도에 찬 이펙터는 후보에 나오지 않고, 전부 찼으면 바로 다음 곡으로 간다', () => {
    const g = new BounceGame('normal', 3);
    g.effects.amp = B.effectMax.amp;
    g.effects.rate = B.effectMax.rate;
    g.effects.split = B.effectMax.split;
    g.advance(B.waves[0].ms);
    expect(g.offers.length).toBe(2);
    expect(g.offers.every((id) => id === 'pierce' || id === 'echo')).toBe(true);

    const h = new BounceGame('normal', 3);
    for (const id of EFFECT_IDS) h.effects[id] = B.effectMax[id];
    h.advance(B.waves[0].ms);
    expect(h.status).toBe('running');
    expect(h.waveIdx).toBe(1);
  });

  it('앙코르(마지막 곡)가 끝나면 공연이 끝난다', () => {
    const g = new BounceGame('normal', 11);
    for (let i = 0; i < B.waves.length - 1; i++) {
      g.advance(B.waves[i].ms);
      expect(g.picking).toBe(true);
      g.pick(0);
    }
    expect(g.waveIdx).toBe(B.waves.length - 1);
    g.advance(B.waves[B.waves.length - 1].ms);
    expect(g.over).toBe(true);
    expect(eventsOf(g, 'end').length).toBe(1);
    expect(g.balls.length).toBe(0);
    const score = g.score;
    g.advance(1000);
    expect(g.score).toBe(score);
    expect(g.summary.seconds).toBe(Math.round((B.waves.reduce((s, w) => s + w.ms, 0)) / 1000));
  });

  it('열기 점수: 곡별 달성률 × 250점의 합, 600 이상이 클리어', () => {
    const g = new BounceGame('normal', 1);
    const goals = B.persona.normal.goals;
    expect(g.score).toBe(0);
    g.wavePower = goals.map((x) => x * 0.6);
    expect(g.score).toBe(600);
    expect(g.cleared).toBe(true);
    g.wavePower = goals.map((x) => x * 0.59);
    expect(g.score).toBe(590);
    expect(g.cleared).toBe(false);
    g.wavePower = goals.map((x) => x * 5);
    expect(g.score).toBe(1000);
    expect(g.summary.waves).toEqual([100, 100, 100, 100]);
  });

  it('목표는 곡이 갈수록 높고 어둠은 관객이 더 단단하다', () => {
    for (const p of ['normal', 'dark'] as const) {
      const goals = B.persona[p].goals;
      for (let i = 1; i < goals.length; i++) expect(goals[i]).toBeGreaterThan(goals[i - 1]);
    }
    expect(B.persona.dark.hpMult).toBeGreaterThan(B.persona.normal.hpMult);
    expect(B.persona.dark.rewardMult).toBe(2);
  });
});

describe('같은 입력이면 같은 판', () => {
  const play = (seed: number, persona: 'normal' | 'dark') => {
    const g = new BounceGame(persona, seed);
    for (let w = 0; w < B.waves.length && !g.over; w++) {
      for (let t = 0; t < 46; t++) {
        g.setAim((40 + ((t * 17) % 100)) * DEG);
        g.advance(500);
      }
      if (g.picking) g.pick(0);
    }
    return { hp: Array.from(g.hp), power: g.wavePower, effects: g.effects, broken: g.broken, status: g.status };
  };

  it('씨앗이 같으면 결과도 같고 다르면 달라진다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      expect(play(123, persona)).toEqual(play(123, persona));
      expect(play(123, persona)).not.toEqual(play(124, persona));
    }
    expect(play(123, 'normal').broken).toBeGreaterThan(20);
    expect(play(123, 'normal').status).toBe('finished');
  });

  it('잘못된 시간(NaN·음수)은 무시한다', () => {
    const g = new BounceGame('normal', 1);
    g.advance(NaN);
    g.advance(-100);
    expect(g.elapsedMs).toBe(0);
  });
});

describe('중형 공연장 직접 공연 연결', () => {
  const ready = () => {
    const s = createInitialState(T0);
    const cleared = { cleared: true, bestScore: 0, cooldownUntil: 0 };
    return { ...s, fans: 100_000, concerts: { ...s.concerts, room: cleared, club: cleared, hall: cleared, solo: cleared } };
  };

  it('중형 공연장만 음파 튕기기이고 다른 공연장은 그대로다', () => {
    expect(manualGameOf('medium')).toBe('bounce');
    expect(manualGameOf('solo')).toBe('merge');
    expect(manualGameOf('hall')).toBe('blocks');
    expect(manualGameOf('club')).toBe('run');
    expect(manualGameOf('room')).toBe('timing');
    expect(manualGameOf('large')).toBe('defense');
    expect(manualGameOf('arena')).toBe('survivor');
    expect(manualGameOf('world')).toBe('prestige');
    expect(manualGameOf('ruins')).toBe('swipe');
  });

  it('직접 공연을 시작하면 음파 튕기기로 쿨다운이 확정된다', () => {
    const begin = beginManualConcert(ready(), 'medium', 'm1');
    if (!begin.ok) throw new Error('begin failed');
    expect(begin.run.game).toBe('bounce');
    expect(begin.state.concerts.medium.cooldownUntil).toBe(T0 + BALANCE.concert.cooldownMs);
    expect(beginManualConcert(begin.state, 'medium', 'm2').ok).toBe(false);
  });

  it('보상: 어둠은 2배, 클리어하지 못하면 절반', () => {
    expect(manualConcertReward(600, 1000, 'normal', 'bounce', true)).toBe(1200);
    expect(manualConcertReward(600, 1000, 'dark', 'bounce', true)).toBe(2400);
    expect(manualConcertReward(600, 1000, 'normal', 'bounce', false)).toBe(600);
  });

  it('클리어는 열기 점수 600으로 정한다', () => {
    const begin = beginManualConcert(ready(), 'medium', 'm3');
    if (!begin.ok) throw new Error('begin failed');
    const won = finishManualConcert(begin.state, begin.run, 600);
    expect(won.ok && won.outcome.cleared).toBe(true);
    expect(won.ok && won.outcome.firstClear).toBe(true);
    expect(won.ok && won.state.concerts.medium.cleared).toBe(true);
    expect(won.ok && won.outcome.coins).toBe(manualConcertReward(600, 600, 'normal', 'bounce') + 7500);

    const begin2 = beginManualConcert(ready(), 'medium', 'm4');
    if (!begin2.ok) throw new Error('begin failed');
    const lost = finishManualConcert(begin2.state, begin2.run, 599);
    expect(lost.ok && lost.outcome.cleared).toBe(false);
    expect(lost.ok && lost.state.concerts.medium.cleared).toBe(false);
    expect(lost.ok && lost.outcome.firstClearCoins).toBe(0);
  });
});

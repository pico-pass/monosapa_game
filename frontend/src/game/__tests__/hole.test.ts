import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance';
import { HoleGame, type Input } from '../hole';

const H = BALANCE.hole;
const FRAME = H.stepMs;
const STILL: Input = { x: 0, y: 0 };

/** 가장 먹음직한 소품을 쫓고 큰 라이벌은 피하는 봇 */
function greedy(persona: 'normal' | 'dark', seed: number, power = 0): HoleGame {
  const g = new HoleGame(persona, seed, power);
  for (let i = 0; i < 60 * 70 && g.status === 'running'; i++) {
    const limit = g.me.r * 0.8;
    let best = -1;
    let bx = 35;
    let by = 35;
    for (const p of g.props) {
      if (p.size > limit) continue;
      const v = (p.size * p.size) / (Math.hypot(p.x - g.me.x, p.y - g.me.y) + 3);
      if (v > best) {
        best = v;
        bx = p.x;
        by = p.y;
      }
    }
    for (const rv of g.rivals) {
      if (rv.r > g.me.r * 1.1 && Math.hypot(rv.x - g.me.x, rv.y - g.me.y) < 16) {
        bx = g.me.x + (g.me.x - rv.x);
        by = g.me.y + (g.me.y - rv.y);
      }
    }
    const d = Math.hypot(bx - g.me.x, by - g.me.y) || 1;
    g.advance(FRAME, { x: (bx - g.me.x) / d, y: (by - g.me.y) / d });
  }
  return g;
}

describe('블랙홀 먹기: 기본 규칙', () => {
  it('같은 씨앗·같은 입력이면 같은 판이다', () => {
    const a = greedy('normal', 21);
    const b = greedy('normal', 21);
    expect([a.me.r, a.eaten, a.score(), a.props.length]).toEqual([b.me.r, b.eaten, b.score(), b.props.length]);
    expect(greedy('normal', 22).me.r).not.toBe(a.me.r);
  });

  it('시작은 소품 H.props개와 라이벌 H.rivals명이고, 소품은 부족하면 다시 채워진다', () => {
    const g = new HoleGame('normal', 1);
    expect(g.props).toHaveLength(H.props);
    expect(g.rivals).toHaveLength(H.rivals);
    g.props.length = 10;
    for (let i = 0; i < 60 * 3; i++) g.advance(FRAME, STILL);
    expect(g.props.length).toBeGreaterThan(10);
    expect(g.props.length).toBeLessThanOrEqual(H.props);
  });

  it('60초가 지나면 끝나고 가만히 있으면 거의 점수가 없다', () => {
    const g = new HoleGame('normal', 2);
    for (let i = 0; i < 60 * 65; i++) g.advance(FRAME, STILL);
    expect(g.status).toBe('done');
    expect(g.timeMs).toBeGreaterThanOrEqual(H.durationMs);
    expect(g.score()).toBeLessThan(150);
  });

  it('큰 dt를 한꺼번에 넣어도 단계로 쪼개 같은 결과가 난다', () => {
    const a = new HoleGame('normal', 4);
    const b = new HoleGame('normal', 4);
    for (let i = 0; i < 120; i++) a.advance(FRAME, { x: 1, y: 0 });
    b.advance(FRAME * 120 + 1, { x: 1, y: 0 });
    expect(b.me.x).toBeCloseTo(a.me.x, 5);
    expect(b.timeMs).toBeCloseTo(a.timeMs, 5);
  });

  it('구멍은 가장자리 밖으로 나가지 않는다', () => {
    const g = new HoleGame('normal', 3);
    for (let i = 0; i < 60 * 10; i++) g.advance(FRAME, { x: -1, y: -1 });
    expect(g.me.x).toBeGreaterThanOrEqual(g.me.r - 1e-9);
    expect(g.me.y).toBeGreaterThanOrEqual(g.me.r - 1e-9);
  });
});

describe('블랙홀 먹기: 삼키기와 잡아먹기', () => {
  const clear = (g: HoleGame) => {
    g.props = [];
    for (const rv of g.rivals) {
      rv.x = 2;
      rv.y = 2;
      rv.invUntil = 1e9; // 라이벌이 끼어들지 않게
    }
  };

  it('구멍보다 충분히 작은 소품만 삼키고, 삼키면 면적이 소품 크기² × 성장만큼 는다', () => {
    const g = new HoleGame('normal', 1);
    clear(g);
    g.props = [
      { id: 1, x: g.me.x, y: g.me.y, tier: 0, size: 1 },
      { id: 2, x: g.me.x, y: g.me.y, tier: 5, size: 6 }, // 너무 크다
    ];
    const r0 = g.me.r;
    g.advance(FRAME, STILL);
    expect(g.eaten).toBe(1);
    expect(g.props.some((p) => p.id === 1)).toBe(false);
    expect(g.props.some((p) => p.id === 2)).toBe(true);
    expect(g.me.r ** 2).toBeCloseTo(r0 ** 2 + 1 * H.growth, 5);
    // 구멍이 커지면 큰 소품도 삼킨다
    g.me.r = 9;
    g.advance(FRAME, STILL);
    expect(g.props.some((p) => p.id === 2)).toBe(false);
  });

  it('멀리 떨어진 소품은 삼키지 못한다', () => {
    const g = new HoleGame('normal', 1);
    clear(g);
    g.props = [{ id: 1, x: g.me.x + g.me.r * 2, y: g.me.y, tier: 0, size: 0.7 }];
    g.advance(FRAME, STILL);
    expect(g.eaten).toBe(0);
  });

  it('어둠 자아는 같은 소품에서 더 빨리 자란다', () => {
    const grow = (p: 'normal' | 'dark') => {
      const g = new HoleGame(p, 1);
      clear(g);
      g.props = [{ id: 1, x: g.me.x, y: g.me.y, tier: 2, size: 1.7 }];
      g.advance(FRAME, STILL);
      return g.me.r;
    };
    expect(grow('dark')).toBeGreaterThan(grow('normal'));
  });

  it('큰 라이벌에게 잡아먹히면 작아져 되살아나고 잠깐 안전하다', () => {
    const g = new HoleGame('normal', 1);
    clear(g);
    g.me.r = 6;
    g.me.x = 30;
    g.me.y = 30;
    const rv = g.rivals[0];
    rv.r = 9;
    rv.x = 30;
    rv.y = 30;
    rv.invUntil = 0;
    rv.tx = rv.x;
    rv.ty = rv.y;
    g.advance(FRAME, STILL);
    expect(g.swallowed).toBe(1);
    expect(g.me.r).toBeLessThan(6);
    expect(g.me.r).toBeGreaterThanOrEqual(H.startR);
    expect(g.me.invUntil).toBeGreaterThan(g.timeMs);
    expect(rv.r).toBeGreaterThan(9);
  });

  it('작은 라이벌을 잡아먹으면 내가 커지고 라이벌은 작아져 다시 나온다', () => {
    const g = new HoleGame('normal', 1);
    clear(g);
    g.me.r = 9;
    g.me.x = 30;
    g.me.y = 30;
    const rv = g.rivals[0];
    rv.r = 5;
    rv.x = 30;
    rv.y = 30;
    rv.invUntil = 0;
    const r0 = g.me.r;
    g.advance(FRAME, STILL);
    expect(g.rivalsEaten).toBe(1);
    expect(g.me.r).toBeGreaterThan(r0);
    expect(rv.r).toBeLessThan(5);
    expect(rv.invUntil).toBeGreaterThan(g.timeMs);
  });

  it('비슷한 크기끼리는 서로 잡아먹지 못한다', () => {
    const g = new HoleGame('normal', 1);
    clear(g);
    g.me.r = 6;
    g.me.x = 30;
    g.me.y = 30;
    const rv = g.rivals[0];
    rv.r = 6.5;
    rv.x = 30;
    rv.y = 30;
    rv.invUntil = 0;
    g.advance(FRAME, STILL);
    expect(g.swallowed).toBe(0);
    expect(g.rivalsEaten).toBe(0);
  });
});

describe('블랙홀 먹기: 점수', () => {
  it('점수는 자란 크기 600 + 순위 400이고 0~1000이다', () => {
    const g = new HoleGame('normal', 1);
    expect(g.score()).toBeLessThanOrEqual(1000);
    g.me.r = H.targetR;
    for (const rv of g.rivals) rv.r = 3;
    expect(g.rank()).toBe(1);
    expect(g.score()).toBe(1000);
    g.me.r = H.startR + (H.targetR - H.startR) / 2;
    g.rivals[0].r = 20;
    expect(g.rank()).toBe(2);
    expect(g.score()).toBe(Math.round(300 + 400 * H.rankFrac[1]));
    g.rivals[1].r = 20;
    expect(g.rank()).toBe(3);
    expect(g.score()).toBe(300);
    g.me.r = 100;
    expect(g.score()).toBe(1000); // 크기 점수는 만점에서 멈추고 순위는 다시 1등
  });

  it('잘 먹는 봇은 높은 점수를, 가만히 있는 쪽은 낮은 점수를 받는다', () => {
    const scores = [1, 2, 3, 4, 5].map((s) => greedy('normal', 100 + s).score());
    expect(scores.reduce((a, b) => a + b, 0) / scores.length).toBeGreaterThanOrEqual(700);
    const idle = new HoleGame('normal', 101);
    for (let i = 0; i < 60 * 65; i++) idle.advance(FRAME, STILL);
    expect(idle.score()).toBeLessThan(Math.min(...scores));
  });

  it('전투력 보너스는 성장을 늘린다', () => {
    const grow = (power: number) => {
      const g = new HoleGame('normal', 1, power);
      g.props = [{ id: 1, x: g.me.x, y: g.me.y, tier: 2, size: 1.7 }];
      g.advance(FRAME, STILL);
      return g.me.r;
    };
    expect(grow(0.5)).toBeGreaterThan(grow(0));
  });
});

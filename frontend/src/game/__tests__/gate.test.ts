import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance';
import { GateGame, applyOp, bestStatic, buildRows, crowdHalfWidth, resolveRow, type Row } from '../gate';

const G = BALANCE.gate;

const row = (...segs: [number, number, Row['segs'][number]['op']][]): Row => ({ y: 0, segs: segs.map(([a, b, op]) => ({ a, b, op })) });

/** 줄이 올 때마다 그 줄에서 가장 좋은 자리로 가는 봇(옆 이동 속도는 실제 제한을 받는다) */
function playBest(persona: 'normal' | 'dark', seed: number, power = 0): GateGame {
  const g = new GateGame(persona, seed, power);
  let tx: number | null = null;
  let seen = -1;
  for (let i = 0; i < 4000 && g.status === 'running'; i++) {
    if (g.next !== seen) {
      seen = g.next;
      const r = g.rows[g.next];
      if (r) {
        let bestN = -1;
        tx = 50;
        for (let x = 5; x <= 95; x++) {
          const w = crowdHalfWidth(g.n);
          const cx = Math.max(w, Math.min(100 - w, x));
          const n = resolveRow(r, cx, g.n);
          if (n > bestN) {
            bestN = n;
            tx = cx;
          }
        }
      }
    }
    g.advance(G.stepMs, { targetX: tx });
  }
  return g;
}

describe('게이트 행진: 문 계산', () => {
  it('더하기·빼기는 몫만큼, 곱하기·나누기는 몫에 곱하고, 싸움은 몫이 얼마든 악플 수만큼 깎는다', () => {
    expect(applyOp({ kind: 'add', v: 10 }, 20, 1)).toBe(30);
    expect(applyOp({ kind: 'add', v: 10 }, 20, 0.5)).toBe(10 + 5);
    expect(applyOp({ kind: 'sub', v: 10 }, 20, 1)).toBe(10);
    expect(applyOp({ kind: 'sub', v: 50 }, 20, 1)).toBe(0);
    expect(applyOp({ kind: 'mul', v: 3 }, 20, 0.5)).toBe(30);
    expect(applyOp({ kind: 'div', v: 2 }, 20, 1)).toBe(10);
    expect(applyOp({ kind: 'fight', v: 8 }, 20, 1)).toBe(12);
    expect(applyOp({ kind: 'fight', v: 8 }, 20, 0.2)).toBe(0); // 몫 4명으로 악플 8명을 만나면 전멸
  });

  it('군중 반폭은 인원에 따라 늘다가 한계에서 멈춘다', () => {
    expect(crowdHalfWidth(0)).toBe(G.crowdBase > G.crowdMinW ? G.crowdBase : G.crowdMinW);
    expect(crowdHalfWidth(100)).toBeGreaterThan(crowdHalfWidth(10));
    expect(crowdHalfWidth(1e9)).toBe(G.crowdMaxW);
  });

  it('줄을 지날 때 걸친 구간마다 몫이 나뉘고, 구간이 하나면 그 문만 적용된다', () => {
    const r = row([0, 50, { kind: 'mul', v: 2 }], [50, 100, { kind: 'sub', v: 100 }]);
    expect(resolveRow(r, 25, 20)).toBe(40); // 완전히 왼쪽 문 안
    expect(resolveRow(r, 75, 20)).toBe(0);
    // 정확히 가운데: 절반은 ×2, 절반은 −(100 × 0.5) → 0
    expect(resolveRow(r, 50, 20)).toBe(20);
    const three = row([0, 33, { kind: 'add', v: 10 }], [33, 66, { kind: 'add', v: 20 }], [66, 100, { kind: 'add', v: 30 }]);
    expect(resolveRow(three, 50, 20)).toBe(40); // 어느 쪽 몫이든 더하기는 몫만큼이라 합은 같다
  });

  it('싸움 구간에 조금이라도 걸치면 몫이 작을수록 크게 손해다', () => {
    const r = row([0, 70, { kind: 'add', v: 0 }], [70, 100, { kind: 'fight', v: 30 }]);
    expect(resolveRow(r, 30, 100)).toBe(100); // 피해서 지남
    expect(resolveRow(r, 70 - 2, 100)).toBeLessThan(100);
  });
});

describe('게이트 행진: 줄 만들기', () => {
  it('줄은 씨앗과 자아로만 정해지고 씨앗이 다르면 다르다', () => {
    expect(buildRows(5, 'normal')).toEqual(buildRows(5, 'normal'));
    expect(buildRows(5, 'normal')).not.toEqual(buildRows(6, 'normal'));
    expect(buildRows(5, 'normal')).not.toEqual(buildRows(5, 'dark'));
  });

  it('모든 줄이 길 전체를 빈틈없이 덮고, 줄마다 더하기나 곱하기 문이 하나는 있으며 간격이 일정하다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const rows = buildRows(seed, persona);
        expect(rows).toHaveLength(G.rows);
        rows.forEach((r, i) => {
          expect(r.y).toBe(G.firstRow + i * G.rowGap);
          expect(r.segs[0].a).toBe(0);
          expect(r.segs[r.segs.length - 1].b).toBe(G.road);
          for (let k = 1; k < r.segs.length; k++) expect(r.segs[k].a).toBe(r.segs[k - 1].b);
          expect(r.segs.some((s) => s.op.kind === 'add' || s.op.kind === 'mul')).toBe(true);
          if (i < G.fightFrom) expect(r.segs.some((s) => s.op.kind === 'fight')).toBe(false);
          for (const s of r.segs) expect(s.b - s.a).toBeGreaterThan(15);
        });
      }
    }
  });

  it('어둠은 −·÷ 문이 더 많다', () => {
    const bad = (persona: 'normal' | 'dark') => {
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) for (const r of buildRows(seed, persona)) for (const s of r.segs) if (s.op.kind === 'sub' || s.op.kind === 'div') n++;
      return n;
    };
    expect(bad('dark')).toBeGreaterThan(bad('normal'));
  });
});

describe('게이트 행진: 달리기', () => {
  it('같은 씨앗·같은 움직임이면 같은 판이다', () => {
    const a = playBest('normal', 12);
    const b = playBest('normal', 12);
    expect([a.n, a.status, a.score()]).toEqual([b.n, b.status, b.score()]);
  });

  it('줄을 지날 때마다 인원이 바뀌고, 끝에서 괴수와 맞붙어 이기거나 진다', () => {
    const g = playBest('normal', 3);
    expect(g.next).toBe(G.rows);
    expect(['won', 'lost']).toContain(g.status);
    expect(g.status === 'won').toBe(g.n >= g.bossHp);
    expect(g.lastDelta?.row).toBe(G.rows - 1);
  });

  it('괴수 체력은 가장 좋은 문만 고른 인원의 bossFrac이고 최소 bossMin이다', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = new GateGame('normal', seed);
      expect(g.bossHp).toBe(Math.max(G.bossMin, Math.round(bestStatic(g.rows, G.start) * G.bossFrac)));
    }
  });

  it('점수는 괴수 대비 인원 비율이 2배면 만점, 딱 이기면 500이다', () => {
    const g = new GateGame('normal', 1);
    g.status = 'won';
    g.n = g.bossHp;
    expect(g.score()).toBe(500);
    g.n = g.bossHp * 2;
    expect(g.score()).toBe(1000);
    g.n = g.bossHp * 5;
    expect(g.score()).toBe(1000);
    g.status = 'lost';
    g.n = Math.floor(g.bossHp / 2);
    expect(g.score()).toBeLessThan(500);
    g.status = 'dead';
    expect(g.score()).toBe(0);
    g.status = 'running';
    expect(g.score()).toBe(0);
  });

  it('잘 고르는 봇은 높은 점수를 받고, 제자리에 서 있기만 하면 낮다', () => {
    const best = [1, 2, 3, 4, 5, 6].map((s) => playBest('normal', 50 + s).score());
    expect(best.reduce((a, b) => a + b, 0) / best.length).toBeGreaterThanOrEqual(800);
    const idle = [1, 2, 3, 4, 5, 6].map((s) => {
      const g = new GateGame('normal', 50 + s);
      for (let i = 0; i < 4000 && g.status === 'running'; i++) g.advance(G.stepMs, { targetX: null });
      return g.score();
    });
    expect(Math.max(...idle)).toBeLessThan(500);
  });

  it('군중이 전멸하면 그 자리에서 끝나고 0점이다', () => {
    const g = new GateGame('normal', 1);
    g.rows[0] = row([0, 100, { kind: 'sub', v: 999 }]);
    g.rows[0].y = 1;
    for (let i = 0; i < 100 && g.status === 'running'; i++) g.advance(G.stepMs, { targetX: null });
    expect(g.status).toBe('dead');
    expect(g.n).toBe(0);
    expect(g.score()).toBe(0);
  });

  it('옆 이동은 속도 제한을 받고 길 밖으로 나가지 않는다', () => {
    const g = new GateGame('normal', 1);
    g.advance(G.stepMs * 4, { targetX: 100 });
    expect(g.x).toBeLessThanOrEqual(G.road / 2 + G.latSpeed * (G.stepMs * 4) / 1000 + 1e-6);
    for (let i = 0; i < 20; i++) g.advance(G.stepMs, { targetX: 100 });
    expect(g.x).toBeLessThanOrEqual(G.road - crowdHalfWidth(g.n) + 1e-6);
  });

  it('전투력 보너스는 처음 인원을 늘린다', () => {
    expect(new GateGame('normal', 1, 0.5).n).toBeGreaterThan(new GateGame('normal', 1, 0).n);
    expect(new GateGame('normal', 1, 0).n).toBe(G.start);
  });

  it('큰 dt를 한꺼번에 넣어도 단계로 쪼개 같은 결과가 난다', () => {
    const a = new GateGame('normal', 2);
    const b = new GateGame('normal', 2);
    for (let i = 0; i < 100; i++) a.advance(G.stepMs, { targetX: 30 });
    b.advance(G.stepMs * 100 + 1, { targetX: 30 });
    expect([b.dist, b.x, b.n]).toEqual([a.dist, a.x, a.n]);
  });
});

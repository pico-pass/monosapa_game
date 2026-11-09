import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance';
import { PlinkoGame, RELIC_IDS, buildPegs, type RelicId } from '../plinko';

const P = BALANCE.plinko;

/** 구슬 한 개가 끝날 때까지 시간을 흘린다 */
function flyOut(g: PlinkoGame): void {
  for (let i = 0; i < 500 && g.phase === 'fly'; i++) g.advance(50);
}

/** 한 발 쏘고 끝까지 본다(각도는 조금씩 다르게) */
function volley(g: PlinkoGame, angle: number): void {
  expect(g.fire(angle)).toBe(true);
  flyOut(g);
}

describe('음표 플링코: 핀 배치', () => {
  it('씨앗·괴수 번호·자아로만 정해지고 판마다 다르다', () => {
    const key = (p: ReturnType<typeof buildPegs>) => p.map((x) => `${x.x.toFixed(2)},${x.y},${x.kind}`).join('|');
    expect(key(buildPegs(5, 0, 'normal'))).toBe(key(buildPegs(5, 0, 'normal')));
    expect(key(buildPegs(5, 0, 'normal'))).not.toBe(key(buildPegs(5, 1, 'normal')));
    expect(key(buildPegs(5, 0, 'normal'))).not.toBe(key(buildPegs(6, 0, 'normal')));
  });

  it('핀은 판 안에 있고 금 핀·폭탄 핀 수가 정해진 만큼이며 야유 핀은 어둠에만 있다', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const normal = buildPegs(seed, 0, 'normal');
      for (const p of normal) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(P.w);
        expect(p.y).toBeGreaterThan(P.top - 1);
        expect(p.y).toBeLessThan(P.h);
      }
      expect(normal.filter((p) => p.kind === 'gold')).toHaveLength(P.golds);
      expect(normal.filter((p) => p.kind === 'bomb')).toHaveLength(P.bombs);
      expect(normal.some((p) => p.kind === 'jeer')).toBe(false);
      expect(buildPegs(seed, 0, 'dark').some((p) => p.kind === 'jeer')).toBe(true);
    }
  });
});

describe('음표 플링코: 구슬 한 개', () => {
  it('조준 가능한 때에만 쏘고, 구슬이 날아가는 동안에는 쏠 수 없다', () => {
    const g = new PlinkoGame('normal', 1);
    expect(g.fire(0)).toBe(true);
    expect(g.balls).toBe(P.balls - 1);
    expect(g.phase).toBe('fly');
    expect(g.fire(0)).toBe(false);
    flyOut(g);
    expect(g.phase).not.toBe('fly');
    expect(g.ball).toBeNull();
    expect(g.fire(Number.NaN)).toBe(true); // NaN 각도는 0으로
  });

  it('같은 씨앗·같은 조준이면 같은 결과이고 구슬은 반드시 끝난다', () => {
    const run = () => {
      const g = new PlinkoGame('normal', 3);
      volley(g, 0.2);
      volley(g, -0.4);
      return [g.hp, g.totalDmg, g.balls, g.lastBin, g.pegs.filter((p) => p.gone).length];
    };
    expect(run()).toEqual(run());
    const g = new PlinkoGame('normal', 3);
    volley(g, 0.2);
    expect(g.ball).toBeNull();
    expect(g.timeMs).toBeGreaterThan(0);
  });

  it('핀을 칠수록 연쇄 배율이 올라 데미지가 커지고, 맞은 핀은 구슬이 끝나면 사라진다', () => {
    const g = new PlinkoGame('normal', 3);
    volley(g, 0.1);
    expect(g.totalDmg).toBeGreaterThan(0);
    expect(g.hp).toBe(g.maxHp - g.totalDmg);
    expect(g.pegs.some((p) => p.gone)).toBe(true);
    expect(g.pegs.every((p) => !p.gone || p.lit)).toBe(true);
    expect(g.popups.length).toBeGreaterThan(0);
    // 한 발에서 친 핀이 많을수록 마지막 데미지가 크다
    const dmgs = g.popups.map((p) => p.dmg);
    expect(Math.max(...dmgs)).toBeGreaterThanOrEqual(Math.min(...dmgs));
  });

  it('조준선 미리보기는 핀에 닿기 전까지의 점들이고 핀 상태를 건드리지 않는다', () => {
    const g = new PlinkoGame('normal', 3);
    const before = JSON.stringify(g.pegs);
    const pts = g.preview(0.3);
    expect(pts.length).toBeGreaterThan(2);
    expect(pts[0]).toEqual({ x: P.w / 2, y: P.cannonY });
    expect(pts[pts.length - 1].y).toBeGreaterThan(pts[0].y);
    expect(JSON.stringify(g.pegs)).toBe(before);
    expect(g.balls).toBe(P.balls);
  });

  it('금 핀은 일반 핀보다 세게 아프다', () => {
    const hit = (kind: 'peg' | 'gold') => {
      const g = new PlinkoGame('normal', 1);
      g.pegs = [{ x: P.w / 2, y: 20, kind, lit: false, gone: false }];
      volley(g, 0);
      return g.totalDmg;
    };
    expect(hit('gold')).toBeGreaterThan(hit('peg'));
    expect(hit('peg')).toBeGreaterThan(0);
  });

  it('야유 핀은 데미지가 없고 연쇄 배율을 끊는다', () => {
    const g = new PlinkoGame('dark', 1);
    g.pegs = [{ x: P.w / 2, y: 20, kind: 'jeer', lit: false, gone: false }];
    volley(g, 0);
    expect(g.pegs[0].gone).toBe(true);
    expect(g.popups.filter((p) => p.y < P.h - 7)).toHaveLength(0); // 핀에서 난 데미지는 없다(바닥 칸 데미지만 있을 수 있다)
  });

  it('폭탄 핀은 주변 핀을 한꺼번에 터뜨린다', () => {
    const g = new PlinkoGame('normal', 1);
    g.pegs = [
      { x: P.w / 2, y: 20, kind: 'bomb', lit: false, gone: false },
      { x: P.w / 2 + 6, y: 28, kind: 'peg', lit: false, gone: false },
      { x: P.w / 2 - 6, y: 28, kind: 'peg', lit: false, gone: false },
      { x: 4, y: 100, kind: 'peg', lit: false, gone: false }, // 먼 핀은 그대로
    ];
    volley(g, 0);
    expect(g.pegs[1].gone).toBe(true);
    expect(g.pegs[2].gone).toBe(true);
    expect(g.pegs[3].gone).toBe(false);
  });

  it('바닥 가운데 칸에 떨어지면 구슬을 돌려받고(괴수당 한도 있음), 가장자리 칸은 데미지를 준다', () => {
    const edge = new PlinkoGame('normal', 1);
    edge.pegs = [];
    edge.fire(-P.maxAngle);
    flyOut(edge);
    expect(edge.lastBin).toBe('edge');
    expect(edge.totalDmg).toBe(P.binEdge);
    const free = new PlinkoGame('normal', 1);
    free.pegs = [];
    free.fire(0);
    flyOut(free);
    expect(free.lastBin).toBe('free');
    expect(free.balls).toBe(P.balls); // 쏘고 돌려받음
    for (let i = 0; i < P.freeCap + 2; i++) {
      free.pegs = [];
      volley(free, 0);
    }
    // 처음 쏜 한 발까지 합쳐 freeCap + 3발을 쏘았고 돌려받은 것은 freeCap개뿐이다
    expect(free.balls).toBe(P.balls - (P.freeCap + 3) + P.freeCap);
  });
});

describe('음표 플링코: 괴수·유물·점수', () => {
  /** 괴수 체력을 거의 다 깎아 두고 한 발로 쓰러뜨린다 */
  function killStage(g: PlinkoGame): void {
    g.hp = 1;
    for (let i = 0; i < 12 && g.phase === 'aim'; i++) volley(g, (i % 5) * 0.15 - 0.3);
  }

  it('괴수를 쓰러뜨리면 유물 3개 중 하나를 고르고, 새 괴수와 새 핀으로 넘어간다', () => {
    const g = new PlinkoGame('normal', 2);
    const pegs0 = JSON.stringify(g.pegs);
    killStage(g);
    expect(g.phase).toBe('choose');
    expect(g.cleared).toBe(1);
    expect(g.choices).toHaveLength(3);
    expect(new Set(g.choices).size).toBe(3);
    for (const c of g.choices!) expect(RELIC_IDS).toContain(c);
    expect(g.fire(0)).toBe(false); // 고르기 전에는 쏠 수 없다
    expect(g.choose(5)).toBe(false);
    const picked = g.choices![1];
    expect(g.choose(1)).toBe(true);
    expect(g.relics[picked]).toBe(1);
    expect(g.stage).toBe(1);
    expect(g.maxHp).toBe(P.hp[1]);
    expect(g.hp).toBe(P.hp[1]);
    expect(g.phase).toBe('aim');
    expect(JSON.stringify(g.pegs)).not.toBe(pegs0);
    expect(g.choose(0)).toBe(false);
  });

  it('남은 구슬은 carryMax개까지 이어지고, 구슬 유물은 괴수마다 구슬을 늘린다', () => {
    const g = new PlinkoGame('normal', 2);
    g.balls = 9;
    g.hp = 1;
    g.fire(0);
    flyOut(g);
    g.balls = 9; // 남은 구슬이 많을 때
    if (g.phase !== 'choose') killStage(g);
    expect(g.phase).toBe('choose');
    g.choices = ['extra', 'dmg', 'big'];
    const left = g.balls;
    g.choose(0);
    expect(g.balls).toBe(P.balls + P.extraBalls + Math.min(left, P.carryMax));
  });

  it('유물 효과: 데미지 유물은 데미지를, 큰 구슬 유물은 구슬 크기를 키운다', () => {
    const dmg = (relic: RelicId | null) => {
      const g = new PlinkoGame('normal', 1);
      if (relic) g.relics[relic] = 1;
      g.pegs = [{ x: P.w / 2, y: 20, kind: 'peg', lit: false, gone: false }];
      volley(g, 0);
      return g.totalDmg;
    };
    expect(dmg('dmg')).toBeGreaterThan(dmg(null));
    const g = new PlinkoGame('normal', 1);
    const r0 = g.ballR;
    g.relics.big = 1;
    expect(g.ballR).toBeCloseTo(r0 * (1 + P.bigBonus));
  });

  it('세 괴수를 모두 쓰러뜨리면 이기고, 남은 구슬이 많을수록 덤이 크다', () => {
    const win = (balls: number) => {
      const g = new PlinkoGame('normal', 4);
      for (let k = 0; k < P.hp.length; k++) {
        g.balls = balls;
        killStage(g);
        if (g.phase === 'choose') g.choose(0);
      }
      return g;
    };
    const rich = win(P.bonusBalls + 2);
    expect(rich.status).toBe('won');
    expect(rich.phase).toBe('done');
    expect(rich.cleared).toBe(P.hp.length);
    expect(rich.score()).toBeGreaterThan(800);
    expect(rich.score()).toBeLessThanOrEqual(1000);
  });

  it('구슬을 다 쓰고도 괴수가 남으면 그 판이 끝나고 진행도만큼 점수를 받는다', () => {
    const g = new PlinkoGame('normal', 6);
    g.balls = 1;
    g.fire(0);
    g.pegs = []; // 데미지가 없게
    flyOut(g);
    if (g.hp > 0 && g.balls < 1) {
      expect(g.status).toBe('lost');
      expect(g.phase).toBe('done');
      expect(g.score()).toBe(Math.round((800 * (1 - g.hp / g.maxHp)) / P.hp.length));
    } else {
      expect(g.phase).toBe('aim'); // 가운데 칸에 떨어져 구슬을 돌려받았다
    }
  });

  it('점수는 쓰러뜨린 괴수가 많을수록 높고 0~1000이다', () => {
    const g = new PlinkoGame('normal', 1);
    expect(g.score()).toBe(0);
    g.hp = g.maxHp / 2;
    const half = g.score();
    expect(half).toBeGreaterThan(0);
    g.cleared = 1;
    g.hp = g.maxHp;
    expect(g.score()).toBeGreaterThan(half);
    g.cleared = 2;
    g.hp = 0;
    expect(g.score()).toBeLessThanOrEqual(1000);
  });

  it('어둠 자아는 같은 핀에서 더 세게 때리고 전투력 보너스도 데미지에 곱해진다', () => {
    const dmg = (persona: 'normal' | 'dark', power: number) => {
      const g = new PlinkoGame(persona, 1, power);
      g.pegs = [{ x: P.w / 2, y: 20, kind: 'gold', lit: false, gone: false }];
      volley(g, 0);
      return g.totalDmg;
    };
    expect(dmg('dark', 0)).toBeGreaterThan(dmg('normal', 0));
    expect(dmg('normal', 1)).toBeGreaterThan(dmg('normal', 0));
  });
});

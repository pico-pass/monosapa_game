import { describe, expect, it } from 'vitest';
import { BALANCE, manualGameOf } from '../balance';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { createInitialState } from '../persistence';
import { GEN_COUNT, PERK_IDS, PrestigeGame, STEP_MS, UPGRADE_IDS, type PrestigeEvent } from '../prestige';

const B = BALANCE.prestige;
const T0 = 1_700_000_000_000;

/** 팬을 바로 쥐여 준다 */
function rich(g: PrestigeGame, fans = 1e9): void {
  g.fans = fans;
}
const evs = (g: PrestigeGame, type: PrestigeEvent['type']) => g.events.filter((e) => e.type === type);

describe('월드투어 인크리멘탈: 시작과 누르기', () => {
  it('팬 0, 응원단 없음, 별빛 없음으로 시작하고 배율은 1이다', () => {
    const g = new PrestigeGame('normal', 1);
    expect(g.fans).toBe(0);
    expect(g.rate).toBe(0);
    expect(g.mult).toBe(1);
    expect(g.stars).toBe(0);
    expect(g.gens).toEqual([0, 0, 0, 0, 0]);
    expect(g.status).toBe('running');
    expect(g.golden).toBeNull();
    expect(g.score).toBe(0);
  });

  it('누르면 팬이 늘고, 가만히 있으면 늘지 않는다', () => {
    const g = new PrestigeGame('normal', 1);
    g.advance(5000);
    expect(g.fans).toBe(0);
    expect(g.tap()).toBe(true);
    expect(g.fans).toBeCloseTo(B.baseTap, 5);
    expect(g.produced).toBeCloseTo(B.baseTap, 5);
    expect(g.taps).toBe(1);
    expect(evs(g, 'tap')).toHaveLength(1);
  });

  it('탭 한 번의 팬은 초당 팬이 늘수록, 탭 강화를 살수록 커진다', () => {
    const g = new PrestigeGame('normal', 1);
    rich(g);
    const t0 = g.tapValue;
    g.buyGen(2);
    expect(g.tapValue).toBeCloseTo(t0 + B.tapShare * g.rate, 5);
    const t1 = g.tapValue;
    g.buyUpgrade('tap');
    expect(g.tapValue).toBeCloseTo(t1 * B.upgrades.tap.mult, 5);
  });
});

describe('월드투어 인크리멘탈: 사기', () => {
  it('응원단을 사면 팬이 줄고 초당 팬이 늘며, 살수록 비용이 오른다', () => {
    const g = new PrestigeGame('normal', 1);
    rich(g, 1000);
    const c0 = g.genCost(0);
    expect(c0).toBe(B.gens[0].cost);
    expect(g.buyGen(0)).toBe(true);
    expect(g.fans).toBe(1000 - c0);
    expect(g.rate).toBeCloseTo(B.gens[0].out, 5);
    expect(g.genCost(0)).toBe(Math.ceil(B.gens[0].cost * B.persona.normal.costGrowth));
    g.buyGen(0);
    expect(g.rate).toBeCloseTo(2 * B.gens[0].out, 5);
    expect(evs(g, 'buy')).toHaveLength(2);
  });

  it('팬이 모자라거나 잘못된 번호면 사지 못한다', () => {
    const g = new PrestigeGame('normal', 1);
    g.fans = B.gens[0].cost - 1;
    expect(g.canBuyGen(0)).toBe(false);
    expect(g.buyGen(0)).toBe(false);
    expect(g.buyGen(-1)).toBe(false);
    expect(g.buyGen(GEN_COUNT)).toBe(false);
    expect(g.buyGen(1.5)).toBe(false);
    expect(g.gens[0]).toBe(0);
  });

  it('응원단은 최대 팀 수까지만 살 수 있다', () => {
    const g = new PrestigeGame('normal', 1);
    rich(g, 1e30);
    for (let i = 0; i < B.genMax + 5; i++) g.buyGen(0);
    expect(g.gens[0]).toBe(B.genMax);
    expect(g.canBuyGen(0)).toBe(false);
  });

  it('강화는 비용이 오르고 한도가 있으며, 합창은 자동 생산을 키운다', () => {
    const g = new PrestigeGame('normal', 1);
    rich(g, 1e30);
    g.buyGen(1);
    const r0 = g.rate;
    expect(g.upgradeCost('choir')).toBe(B.upgrades.choir.cost);
    expect(g.buyUpgrade('choir')).toBe(true);
    expect(g.rate).toBeCloseTo(r0 * B.upgrades.choir.mult, 5);
    expect(g.upgradeCost('choir')).toBe(B.upgrades.choir.cost * B.upgrades.choir.growth);
    for (const id of UPGRADE_IDS) for (let i = 0; i < 20; i++) g.buyUpgrade(id);
    for (const id of UPGRADE_IDS) {
      expect(g.ups[id]).toBe(B.upgrades[id].max);
      expect(g.canBuyUpgrade(id)).toBe(false);
    }
  });

  it('시간이 지나면 초당 팬만큼 늘고 곡 기록에도 쌓인다', () => {
    const g = new PrestigeGame('normal', 1);
    rich(g, 1000);
    g.buyGen(1);
    const f0 = g.fans;
    g.advance(2000);
    expect(g.fans - f0).toBeCloseTo(2 * B.gens[1].out, 3);
    expect(g.producedWave[0]).toBeCloseTo(2 * B.gens[1].out, 3);
  });

  it('어둠은 비용이 더 비싸다', () => {
    const n = new PrestigeGame('normal', 1);
    const d = new PrestigeGame('dark', 1);
    expect(d.genCost(0)).toBeGreaterThan(n.genCost(0));
    expect(d.upgradeCost('tap')).toBeGreaterThan(n.upgradeCost('tap'));
  });
});

describe('월드투어 인크리멘탈: 월드 스포트라이트', () => {
  it('처음 일정 시간 뒤에 뜨고 누르면 팬을 받는다', () => {
    const g = new PrestigeGame('normal', 3);
    g.advance(B.golden.firstMs - STEP_MS * 2);
    expect(g.golden).toBeNull();
    g.advance(STEP_MS * 3);
    expect(g.golden).not.toBeNull();
    expect(g.golden!.x).toBeGreaterThan(0);
    expect(g.golden!.x).toBeLessThan(1);
    expect(evs(g, 'goldenOn')).toHaveLength(1);
    const before = g.fans;
    expect(g.catchGolden()).toBe(true);
    expect(g.fans - before).toBeCloseTo(B.golden.minReward * g.mult, 5);
    expect(g.golden).toBeNull();
    expect(g.goldens).toBe(1);
    expect(g.catchGolden()).toBe(false);
  });

  it('보상은 초당 팬이 많을수록 크다', () => {
    const g = new PrestigeGame('normal', 3);
    rich(g);
    g.buyGen(3);
    g.buyGen(3);
    g.advance(B.golden.firstMs + STEP_MS);
    const before = g.fans;
    g.catchGolden();
    expect(g.fans - before).toBeCloseTo(g.rate * B.golden.rewardSec, 3);
  });

  it('잡지 못하면 시간이 지나 사라지고 다음 것이 정해진다', () => {
    const g = new PrestigeGame('normal', 3);
    g.advance(B.golden.firstMs + STEP_MS);
    expect(g.golden).not.toBeNull();
    g.advance(B.golden.lifeMs + STEP_MS * 2);
    expect(g.golden).toBeNull();
    expect(evs(g, 'goldenMiss')).toHaveLength(1);
    g.advance(B.golden.maxGapMs + STEP_MS * 2);
    expect(g.golden).not.toBeNull();
  });
});

describe('월드투어 인크리멘탈: 곡이 끝나면', () => {
  /** 곡 하나를 돌리고 퍼크를 고르는 상태까지 간다 */
  function endFirstWave(g: PrestigeGame, made = 1000): void {
    g.producedWave[0] = made;
    g.advance(B.waves[0].ms);
  }

  it('별빛을 얻고 영구 배율이 오르며 시간이 멈춘 채 퍼크 3개 중 하나를 고른다', () => {
    const g = new PrestigeGame('normal', 5);
    endFirstWave(g, 1000);
    expect(g.picking).toBe(true);
    const gain = Math.floor(Math.log2(1 + (1000 + 0) / B.star.div));
    expect(g.lastGain).toBe(gain);
    expect(g.stars).toBe(gain);
    expect(g.mult).toBeCloseTo(1 + B.persona.normal.starStep * gain, 5);
    expect(g.offers).toHaveLength(B.offers);
    expect(new Set(g.offers).size).toBe(B.offers);
    const t = g.elapsedMs;
    g.advance(5000);
    expect(g.elapsedMs).toBe(t);
    expect(g.tap()).toBe(false);
    expect(g.buyGen(0)).toBe(false);
    expect(g.pick(9)).toBe(false);
    expect(evs(g, 'waveEnd')).toHaveLength(1);
    expect(evs(g, 'pick')).toHaveLength(1);
  });

  it('퍼크를 고르면 팬·응원단·강화가 리셋되고 별빛과 퍼크만 남아 다음 곡이 시작된다', () => {
    const g = new PrestigeGame('normal', 5);
    rich(g, 1e6);
    g.buyGen(0);
    g.buyUpgrade('tap');
    endFirstWave(g, 4000);
    const stars = g.stars;
    const id = g.offers[0];
    expect(g.pick(0)).toBe(true);
    expect(g.waveIdx).toBe(1);
    expect(g.waveMs).toBe(0);
    expect(g.status).toBe('running');
    expect(g.gens).toEqual([0, 0, 0, 0, 0]);
    expect(g.ups).toEqual({ tap: 0, choir: 0 });
    expect(g.produced).toBe(0);
    expect(g.stars).toBe(stars);
    expect(g.perks[id]).toBe(1);
    expect(g.producedWave[0]).toBeGreaterThanOrEqual(4000);
    expect(evs(g, 'wave')).toHaveLength(1);
  });

  it('후원금 퍼크는 다음 곡을 팬을 가지고 시작하게 하고, 단골은 스포트라이트를 더 빨리 띄운다', () => {
    const g = new PrestigeGame('normal', 5);
    endFirstWave(g);
    g.offers = ['seed', 'luck', 'star'];
    g.pick(0);
    expect(g.fans).toBe(B.perks.seed.fans[0]);
    expect(g.produced).toBe(0);

    const h = new PrestigeGame('normal', 5);
    endFirstWave(h);
    h.offers = ['luck', 'seed', 'star'];
    h.pick(0);
    h.advance(B.golden.firstMs * B.perks.luck.gapRate + STEP_MS * 2);
    expect(h.golden).not.toBeNull();
    expect(h.golden!.leftMs).toBeGreaterThan(B.golden.lifeMs - 200);
  });

  it('팬서비스·월드 응원단·할인·별빛 증폭이 각자 수치를 바꾼다', () => {
    const g = new PrestigeGame('normal', 5);
    rich(g, 1e6);
    g.buyGen(2);
    const rate = g.rate;
    const tap = g.tapValue;
    const cost = g.genCost(1);
    g.perks.autox = 1;
    expect(g.rate).toBeCloseTo(rate * B.perks.autox.mult, 5);
    g.perks.autox = 0;
    g.perks.tapx = 2;
    expect(g.tapValue).toBeCloseTo(tap * B.perks.tapx.mult ** 2, 5);
    g.perks.discount = 1;
    expect(g.genCost(1)).toBe(Math.ceil(B.gens[1].cost * B.perks.discount.mult));
    expect(g.genCost(1)).toBeLessThan(cost);

    const a = new PrestigeGame('normal', 5);
    a.perks.star = 2;
    a.producedWave[0] = 1000;
    a.advance(B.waves[0].ms);
    const plain = new PrestigeGame('normal', 5);
    plain.producedWave[0] = 1000;
    plain.advance(B.waves[0].ms);
    expect(a.lastGain).toBeGreaterThan(plain.lastGain);
  });

  it('한도에 찬 퍼크는 후보에서 빠진다', () => {
    const g = new PrestigeGame('normal', 5);
    for (const id of PERK_IDS) g.perks[id] = B.perkMax;
    g.perks.star = B.perkMax - 1;
    endFirstWave(g);
    expect(g.offers).toEqual(['star']);
    g.pick(0);
    expect(g.perks.star).toBe(B.perkMax);
    expect(g.waveIdx).toBe(1);
  });

  it('마지막 곡이 끝나면 퍼크 없이 공연이 끝난다', () => {
    const g = new PrestigeGame('normal', 5);
    let guard = 0;
    while (!g.over && guard++ < 20) {
      g.advance(B.waves[0].ms);
      if (g.picking) g.pick(0);
    }
    expect(g.over).toBe(true);
    expect(g.waveIdx).toBe(B.waves.length - 1);
    expect(g.events.some((e) => e.type === 'end')).toBe(true);
    expect(g.tap()).toBe(false);
    expect(g.pick(0)).toBe(false);
    expect(g.summary.seconds).toBeGreaterThanOrEqual(91);
  });
});

describe('월드투어 인크리멘탈: 점수', () => {
  it('열기 달성률은 자릿수(로그)로 잰다', () => {
    const g = new PrestigeGame('normal', 1);
    const goal = B.persona.normal.goals[0];
    g.producedWave[0] = goal;
    expect(g.waveRatio(0)).toBe(1);
    g.producedWave[0] = goal * 10;
    expect(g.waveRatio(0)).toBe(1);
    g.producedWave[0] = goal / 10 ** (B.logSpan / 2);
    expect(g.waveRatio(0)).toBeCloseTo(0.5, 1);
    g.producedWave[0] = goal / 10 ** B.logSpan;
    expect(g.waveRatio(0)).toBeCloseTo(0, 1);
    g.producedWave[0] = 0;
    expect(g.waveRatio(0)).toBe(0);
  });

  it('열기 점수는 곡별 달성률 × 곡당 점수의 합이고 600 이상이 클리어다', () => {
    const g = new PrestigeGame('normal', 1);
    const goals = B.persona.normal.goals;
    g.producedWave = [goals[0], goals[1], goals[2], 0];
    expect(g.score).toBe(B.waveScore * 3);
    expect(g.cleared).toBe(true);
    g.producedWave = [goals[0], goals[1], goals[2] / 10 ** (B.logSpan * 0.4), 0];
    expect(g.score).toBeCloseTo(B.waveScore * 2.6, -1);
    g.producedWave = [goals[0], goals[1], 0, 0];
    expect(g.score).toBe(B.waveScore * 2);
    expect(g.cleared).toBe(false);
    g.producedWave = goals.map((x) => x * 100);
    expect(g.score).toBe(1000);
  });

  it('결과 요약에 만든 팬·별빛·배율·탭·퍼크가 담긴다', () => {
    const g = new PrestigeGame('normal', 1);
    g.producedWave = [100, 200, 300, 400];
    g.stars = 8;
    g.taps = 77;
    g.goldens = 3;
    g.perks.autox = 2;
    const s = g.summary;
    expect(s).toMatchObject({ produced: 1000, stars: 8, taps: 77, goldens: 3 });
    expect(s.mult).toBeCloseTo(1 + B.persona.normal.starStep * 8, 2);
    expect(s.perks.autox).toBe(2);
    expect(s.waves).toHaveLength(4);
  });
});

/** 누르고, 효율이 좋은 것을 사고, 스포트라이트를 잡는 봇 */
function play(g: PrestigeGame, tapsPerSec: number, buy: boolean, golden: boolean): void {
  const think = 200;
  let acc = 0;
  let guard = 0;
  while (!g.over && guard++ < 100000) {
    if (g.picking) {
      const order = ['autox', 'star', 'tapx', 'seed', 'discount', 'luck'];
      g.pick(Math.max(0, g.offers.findIndex((id) => id === order.find((o) => g.offers.includes(o as never)))));
      continue;
    }
    if (golden && g.golden) g.catchGolden();
    acc += (tapsPerSec * think) / 1000;
    while (acc >= 1) {
      acc -= 1;
      g.tap();
    }
    if (buy) {
      for (let k = 0; k < 20; k++) {
        const items: { v: number; cost: number; go: () => boolean }[] = [];
        for (let i = 0; i < GEN_COUNT; i++) if (g.gens[i] < B.genMax) items.push({ v: (B.gens[i].out * g.autoMult) / g.genCost(i), cost: g.genCost(i), go: () => g.buyGen(i) });
        for (const id of UPGRADE_IDS) {
          if (g.ups[id] >= B.upgrades[id].max) continue;
          const benefit = id === 'choir' ? g.rate * (B.upgrades.choir.mult - 1) : g.tapValue * tapsPerSec * (B.upgrades.tap.mult - 1);
          items.push({ v: benefit / g.upgradeCost(id), cost: g.upgradeCost(id), go: () => g.buyUpgrade(id) });
        }
        items.sort((a, b) => b.v - a.v);
        const top = items[0];
        const income = g.rate + tapsPerSec * g.tapValue;
        if (!top) break;
        if (top.cost <= g.fans) {
          if (!top.go()) break;
          continue;
        }
        if (income > 0 && (top.cost - g.fans) / income < 4) break;
        const aff = items.find((it) => it.cost <= g.fans && it.v > 0);
        if (!aff || !aff.go()) break;
      }
    }
    g.advance(think);
    g.events.length = 0;
  }
}

describe('월드투어 인크리멘탈: 난이도와 재현성', () => {
  it('같은 씨앗·같은 조작이면 항상 같은 판이다', () => {
    const run = () => {
      const g = new PrestigeGame('normal', 2468);
      play(g, 6, true, true);
      return { score: g.score, summary: g.summary };
    };
    expect(run()).toEqual(run());
  });

  it('가만히 있거나 누르기만 하거나 사기만 해서는 클리어하지 못한다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      const idle = new PrestigeGame(persona, 4);
      play(idle, 0, false, false);
      expect(idle.score).toBe(0);
      const tapper = new PrestigeGame(persona, 4);
      play(tapper, 5, false, true);
      expect(tapper.cleared).toBe(false);
      const buyer = new PrestigeGame(persona, 4);
      play(buyer, 0, true, false);
      expect(buyer.cleared).toBe(false);
    }
  });

  it('눌러서 모으고 잘 사고 스포트라이트를 잡으면 클리어한다', () => {
    let clears = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = new PrestigeGame('normal', seed * 7919);
      play(g, 6, true, true);
      if (g.cleared) clears += 1;
    }
    expect(clears).toBeGreaterThanOrEqual(5);
  });

  it('어둠 판도 같은 방식으로 클리어할 수 있다', () => {
    let clears = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = new PrestigeGame('dark', seed * 7919);
      play(g, 6, true, true);
      if (g.cleared) clears += 1;
    }
    expect(clears).toBeGreaterThanOrEqual(5);
  });

  it('스포트라이트를 놓치고 느리게 누르면 클리어하지 못한다', () => {
    let clears = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = new PrestigeGame('normal', seed * 7919);
      play(g, 2, true, false);
      if (g.cleared) clears += 1;
    }
    expect(clears).toBe(0);
  });
});

describe('월클 콘서트 직접 공연 연결', () => {
  const ready = () => {
    const s = createInitialState(T0);
    const cleared = { cleared: true, bestScore: 0, cooldownUntil: 0 };
    return {
      ...s,
      fans: 1e12,
      concerts: { ...s.concerts, room: cleared, club: cleared, hall: cleared, solo: cleared, medium: cleared, large: cleared, arena: cleared },
    };
  };

  it('월클 콘서트만 월드투어 인크리멘탈이다', () => {
    expect(manualGameOf('world')).toBe('prestige');
    expect(manualGameOf('arena')).toBe('survivor');
    expect(manualGameOf('room')).toBe('timing');
  });

  it('직접 공연을 시작하면 월드투어 인크리멘탈로 쿨다운이 확정된다', () => {
    const begin = beginManualConcert(ready(), 'world', 'p1');
    if (!begin.ok) throw new Error('begin failed');
    expect(begin.run.game).toBe('prestige');
    expect(begin.state.concerts.world.cooldownUntil).toBe(T0 + BALANCE.concert.cooldownMs);
    expect(beginManualConcert(begin.state, 'world', 'p2').ok).toBe(false);
  });

  it('보상: 어둠은 2배, 클리어하지 못하면 절반', () => {
    expect(manualConcertReward(6000, 1000, 'normal', 'prestige', true)).toBe(12000);
    expect(manualConcertReward(6000, 1000, 'dark', 'prestige', true)).toBe(24000);
    expect(manualConcertReward(6000, 1000, 'normal', 'prestige', false)).toBe(6000);
  });

  it('클리어는 열기 점수 600으로 정한다', () => {
    const begin = beginManualConcert(ready(), 'world', 'p3');
    if (!begin.ok) throw new Error('begin failed');
    const won = finishManualConcert(begin.state, begin.run, 600);
    expect(won.ok && won.outcome.cleared).toBe(true);
    expect(won.ok && won.state.concerts.world.cleared).toBe(true);
    const begin2 = beginManualConcert(ready(), 'world', 'p4');
    if (!begin2.ok) throw new Error('begin failed');
    const lost = finishManualConcert(begin2.state, begin2.run, 599);
    expect(lost.ok && lost.outcome.cleared).toBe(false);
    expect(lost.ok && lost.state.concerts.world.cleared).toBe(false);
  });
});

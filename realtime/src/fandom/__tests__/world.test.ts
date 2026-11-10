import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../rng.js';
import { FANDOM, FandomWorld, fandomReward, type RunResult } from '../world.js';

interface Probe {
  over: { uid: string; r: RunResult }[];
  roster: number;
}

function setup(seed = 1) {
  const probe: Probe = { over: [], roster: 0 };
  const world = new FandomWorld('w1', mulberry32(seed), {
    over: (uid, r) => probe.over.push({ uid, r }),
    roster: () => probe.roster++,
  });
  return { world, probe };
}

const clocks = new WeakMap<FandomWorld, number>();

/** 시계를 stepMs 단위로 n걸음 돌린다 */
function run(world: FandomWorld, steps: number): void {
  let t = clocks.get(world);
  if (t === undefined) {
    t = 0;
    world.advance(0);
  }
  for (let i = 0; i < steps; i++) {
    t += FANDOM.stepMs;
    world.advance(t);
  }
  clocks.set(world, t);
}

/** 사람 뱀을 원하는 자리에 세우고 나머지 뱀은 멀리 치운다 */
function place(world: FandomWorld, uid: string, x: number, y: number, a: number): ReturnType<FandomWorld['join']> {
  const s = world.join(uid, uid);
  if (!s) throw new Error('못 들어왔어요');
  s.pts = s.pts.map((_, i) => ({ x: x - Math.cos(a) * FANDOM.seg * i, y: y - Math.sin(a) * FANDOM.seg * i }));
  s.a = s.ta = a;
  s.shieldUntil = 0;
  return s;
}

/** 점을 모두 치운다(처음부터 있던 점이 다시 채워지지 않게 센 값을 가득 찬 것으로 둔다) */
function clear(world: FandomWorld): void {
  world.dots.length = 0;
  (world as unknown as { ambient: number }).ambient = FANDOM.ambientDots;
}

describe('팬덤 모으기 세계', () => {
  it('들어오면 사람과 봇이 목표 수만큼 채워지고, 나가면 봇이 다시 늘어난다', () => {
    const { world, probe } = setup();
    world.join('a', 'A');
    expect(world.humans).toBe(1);
    expect(world.snakes.size).toBe(FANDOM.targetSnakes);
    expect(probe.roster).toBeGreaterThan(0);
    for (const u of ['b', 'c', 'd']) world.join(u, u);
    expect(world.snakes.size).toBe(FANDOM.targetSnakes);
    expect([...world.snakes.values()].filter((s) => s.bot)).toHaveLength(FANDOM.targetSnakes - 4);
    for (const u of ['e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) world.join(u, u);
    // 봇은 최소 minBots 마리는 남는다
    expect([...world.snakes.values()].filter((s) => s.bot)).toHaveLength(FANDOM.minBots);
    expect(world.full).toBe(true);
    expect(world.join('z', 'Z')).toBeNull();
    world.leave('a');
    expect(world.full).toBe(false);
  });

  it('가고 싶은 방향으로 방향을 돌리되 한 번에 돌 수 있는 양은 제한된다', () => {
    const { world } = setup();
    const s = place(world, 'a', 60, 60, 0)!;
    world.steer('a', Math.PI, false);
    run(world, 1);
    const dt = FANDOM.stepMs / 1000;
    expect(Math.abs(s.a)).toBeCloseTo(FANDOM.turn * dt, 5);
    run(world, 60);
    expect(Math.abs(Math.abs(s.a) - Math.PI)).toBeLessThan(0.01);
    world.steer('a', Number.NaN, false);
    expect(Number.isFinite(s.ta)).toBe(true);
  });

  it('앞으로 가고 벽에서는 멈춘다(밖으로 나가지 않는다)', () => {
    const { world } = setup();
    const s = place(world, 'a', 60, 60, 0)!;
    clear(world);
    s.shieldUntil = 1e9;
    const x0 = s.pts[0].x;
    run(world, 20);
    expect(s.pts[0].x - x0).toBeCloseTo(FANDOM.speed * (20 * FANDOM.stepMs) / 1000, 4);
    run(world, 400);
    expect(s.pts[0].x).toBeCloseTo(FANDOM.w - FANDOM.wallMargin, 5);
    for (const p of s.pts) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(FANDOM.w);
    }
  });

  it('팬 점을 먹으면 팬이 늘고 몸이 길어지며 처음부터 있던 점은 다시 채워진다', () => {
    const { world } = setup();
    const s = place(world, 'a', 40, 60, 0)!;
    clear(world);
    s.shieldUntil = 1e9;
    world.dots.push({ x: 41, y: 60, v: 1, amb: true, until: 0 });
    (world as unknown as { ambient: number }).ambient = 1;
    run(world, 3);
    expect(world.dots.some((d) => d.x === 41 && d.y === 60)).toBe(false);
    expect(s.fans).toBeGreaterThanOrEqual(1);
    expect(s.peak).toBeGreaterThanOrEqual(1);
    expect(world.dots.length).toBeGreaterThanOrEqual(FANDOM.ambientDots - 1);
    s.fans = 30;
    run(world, 1);
    expect(s.pts.length).toBe(FANDOM.startSegs + Math.floor(30 / FANDOM.fansPerSeg));
    s.fans = 100000;
    run(world, 1);
    expect(s.pts.length).toBe(FANDOM.maxSegs);
  });

  it('남의 몸에 머리를 박으면 쓰러지고 팬 점이 떨어지며 도전이 끝나 보상이 정해진다', () => {
    const { world, probe } = setup();
    const a = place(world, 'a', 50, 50, 0)!;
    clear(world);
    // 봇 하나를 가로로 길게 눕혀 a의 앞을 막는다
    const bot = [...world.snakes.values()].find((s) => s.bot)!;
    bot.shieldUntil = 0;
    bot.fans = 40;
    bot.pts = Array.from({ length: 30 }, (_, i) => ({ x: 53, y: 40 + i * FANDOM.seg }));
    a.fans = 60;
    a.peak = 60;
    run(world, 12);
    expect(probe.over).toHaveLength(1);
    expect(probe.over[0].uid).toBe('a');
    expect(probe.over[0].r).toMatchObject({ why: 'dead', fans: 60, peak: 60, by: bot.name, reward: fandomReward(60) });
    expect(bot.kills).toBe(1);
    expect(world.dots.some((d) => d.v === FANDOM.dropValue)).toBe(true);
    expect(world.has('a')).toBe(false);
  });

  it('방패 중에는 쓰러지지 않고, 방패 중인 뱀의 몸은 통과할 수 있다', () => {
    const { world, probe } = setup();
    const a = place(world, 'a', 50, 50, 0)!;
    clear(world);
    a.shieldUntil = 1e9;
    const bot = [...world.snakes.values()].find((s) => s.bot)!;
    bot.shieldUntil = 0;
    bot.pts = Array.from({ length: 30 }, (_, i) => ({ x: 53, y: 40 + i * FANDOM.seg }));
    run(world, 12);
    expect(probe.over).toHaveLength(0);
    a.shieldUntil = 0;
    bot.shieldUntil = 1e9;
    a.pts = a.pts.map((p) => ({ x: p.x - 8, y: p.y }));
    run(world, 40);
    expect(probe.over).toHaveLength(0);
  });

  it('머리끼리 부딪히면 팬이 적은 쪽이 쓰러진다', () => {
    const { world, probe } = setup();
    const a = place(world, 'a', 50, 50, 0)!;
    clear(world);
    const bot = [...world.snakes.values()].find((s) => s.bot)!;
    bot.shieldUntil = 0;
    bot.ta = bot.a = Math.PI;
    bot.pts = Array.from({ length: 10 }, (_, i) => ({ x: 58 + i * FANDOM.seg, y: 50 }));
    a.fans = 5;
    bot.fans = 20;
    run(world, 12);
    expect(probe.over.map((o) => o.uid)).toEqual(['a']);
    expect(bot.alive).toBe(true);
  });

  it('도전 시간이 다 되면 끝나고, 나가면 지금 기록으로 끝난다', () => {
    const { world, probe } = setup();
    const a = place(world, 'a', 60, 60, 0)!;
    a.shieldUntil = 1e9;
    a.peak = 55;
    run(world, FANDOM.runMs / FANDOM.stepMs + 2);
    expect(probe.over).toHaveLength(1);
    expect(probe.over[0].r).toMatchObject({ why: 'time', reward: fandomReward(55) });
    const b = setup();
    b.world.join('b', 'B');
    b.world.leave('b');
    expect(b.probe.over[0].r.why).toBe('left');
    b.world.leave('b');
    expect(b.probe.over).toHaveLength(1);
  });

  it('부스트는 팬을 흘리고 팬이 모자라면 못 쓴다', () => {
    const { world } = setup();
    const s = place(world, 'a', 20, 60, 0)!;
    clear(world);
    s.shieldUntil = 1e9;
    s.fans = 30;
    world.steer('a', 0, true);
    run(world, 20); // 1초
    expect(s.fans).toBeLessThan(30);
    expect(s.fans).toBeGreaterThanOrEqual(30 - FANDOM.boostCost - 1);
    expect(world.dots.some((d) => !d.amb && d.v === 1)).toBe(true);
    const x = s.pts[0].x;
    s.fans = FANDOM.boostMin - 1;
    run(world, 20);
    expect(s.pts[0].x - x).toBeCloseTo(FANDOM.speed, 0);
  });

  it('스냅샷은 시야 안의 것만, 좌표는 10배 정수로 담고 순위를 알려 준다', () => {
    const { world } = setup();
    const s = place(world, 'a', 60, 60, 0)!;
    clear(world);
    s.fans = 12;
    world.dots.push({ x: 60, y: 70, v: 1, amb: false, until: 0 }, { x: 5, y: 5, v: 1, amb: false, until: 0 });
    const snap = world.snapshotFor('a')!;
    expect(snap.t).toBe('f.s');
    expect(snap.me).toMatchObject({ x: 600, y: 600, fans: 12 });
    expect(snap.dots).toEqual([600, 700, 1]);
    expect(snap.sn[0].slice(0, 3)).toEqual([s.id, 12, 0]);
    expect(snap.sn[0].length).toBe(3 + s.pts.length * 2);
    expect(snap.sn[0].every(Number.isInteger)).toBe(true);
    expect(snap.lb[0]).toEqual([s.id, 12]);
    expect(snap.rk).toEqual([1, FANDOM.targetSnakes]);
    expect(snap.left).toBe(FANDOM.runMs);
    expect(world.snapshotFor('nobody')).toBeNull();
  });

  it('같은 씨앗과 같은 입력이면 똑같이 진행된다', () => {
    const play = () => {
      const { world } = setup(9);
      world.join('a', 'A');
      for (let i = 0; i < 200; i++) {
        world.steer('a', Math.sin(i / 17) * 3, i % 50 < 10);
        run(world, 1);
      }
      return JSON.stringify(world.snapshotFor('a')) + JSON.stringify([...world.snakes.values()].map((s) => [s.id, s.fans, s.alive]));
    };
    expect(play()).toBe(play());
  });

  it('봇만 오래 돌려도 값이 깨지지 않고 벽 안에 있으며 팬을 모은다', () => {
    const { world } = setup(3);
    const a = place(world, 'a', 60, 60, 0)!;
    a.shieldUntil = 1e9;
    a.endsAt = 1e12;
    let sawDeath = false;
    for (let i = 0; i < 2400; i++) {
      world.steer('a', i / 40, false);
      run(world, 1);
      for (const s of world.snakes.values()) if (s.bot && !s.alive) sawDeath = true;
    }
    const bots = [...world.snakes.values()].filter((s) => s.bot);
    expect(bots.length).toBeGreaterThan(0);
    for (const s of bots) {
      for (const p of s.pts) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(FANDOM.w);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(FANDOM.h);
      }
    }
    expect(Math.max(...bots.map((s) => s.peak))).toBeGreaterThan(10);
    expect(typeof sawDeath).toBe('boolean');
  });
});

describe('팬덤 모으기 보상', () => {
  it('가장 많았던 팬 수가 구간에 닿을 때마다 보상이 오른다', () => {
    expect(fandomReward(0)).toBe(0);
    expect(fandomReward(FANDOM.rewardTiers[0][0] - 1)).toBe(0);
    let prev = 0;
    for (const [fans, diamonds] of FANDOM.rewardTiers) {
      expect(fandomReward(fans)).toBe(diamonds);
      expect(diamonds).toBeGreaterThan(prev);
      prev = diamonds;
    }
    expect(fandomReward(1e9)).toBe(FANDOM.rewardTiers.at(-1)![1]);
  });
});

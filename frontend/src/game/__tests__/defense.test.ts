import { describe, expect, it } from 'vitest';
import { BALANCE, manualGameOf } from '../balance';
import {
  COLS,
  COUNTER_ROLE,
  DefenseGame,
  GRID_Y,
  INCIDENT_IDS,
  LINE_Y,
  ROLE_IDS,
  SLOTS,
  slotAt,
  slotX,
  slotY,
  type DefenseEvent,
  type Incident,
  type IncidentId,
  type RoleId,
} from '../defense';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { createInitialState } from '../persistence';

const B = BALANCE.defense;
const T0 = 1_700_000_000_000;

let nextId = 9000;
/** 사고 하나를 직접 올려 놓는다(계획된 사고는 첫 400ms 안에는 나오지 않는다) */
function put(g: DefenseGame, kind: IncidentId, x: number, y: number, hp = 1e9): Incident {
  const inc: Incident = { id: nextId++, kind, lane: Math.floor(x), x, y, hp, maxHp: hp, slowMs: 0, ageMs: 0, phase: 0, speed: B.incidents[kind].speed };
  g.incidents.push(inc);
  return inc;
}
/** 스태프를 자리 slot에 바로 세운다 */
function stand(g: DefenseGame, slot: number, role: RoleId, rank = 1): void {
  g.slots[slot] = { role, rank, cdMs: 0 };
}
const shots = (g: DefenseGame): Extract<DefenseEvent, { type: 'shot' }>[] => g.events.filter((e): e is Extract<DefenseEvent, { type: 'shot' }> => e.type === 'shot');

/** 곡 하나를 끝까지 돌린다(사고를 하나도 안 막는 판) */
function idleWave(g: DefenseGame): void {
  g.start();
  while (g.playing) g.advance(500);
}

/** 예보를 보고 고용하고, 합치고, 가장 많이 내려온 사고를 누르는 봇 */
function bot(g: DefenseGame, thinkMs: number): void {
  const acts = (once: boolean) => {
    for (let n = 0; n < 40; n++) {
      const m = g.findMerge();
      if (m) {
        g.move(m[0], m[1]);
        if (once) return;
        continue;
      }
      if (g.freeSlot() >= 0 && g.cash >= g.hireCost) {
        const hp = g.forecastHp();
        const need: Record<RoleId, number> = { sound: 0, stage: 0, light: 0, safety: 0 };
        for (const k of INCIDENT_IDS) need[COUNTER_ROLE[k]] += hp[k];
        const role = [...ROLE_IDS].sort((a, b) => need[b] / (1 + g.roleRanks(b)) - need[a] / (1 + g.roleRanks(a)))[0];
        g.hire(role);
        if (once) return;
        continue;
      }
      if (once && g.playing) {
        let front: Incident | null = null;
        for (const inc of g.incidents) if (inc.hp > 0 && (!front || inc.y > front.y)) front = inc;
        if (front) g.tap(front.x, front.y);
      }
      return;
    }
  };
  let guard = 0;
  while (!g.over && guard++ < 20000) {
    if (g.status === 'prep') {
      acts(false);
      g.start();
      continue;
    }
    acts(true);
    g.advance(thinkMs);
    g.events.length = 0;
  }
}

describe('돌발 사고 막기: 판 만들기와 예보', () => {
  it('처음에는 빈 자리 15칸과 시작 예산이 있고 준비 상태라 시간이 흐르지 않는다', () => {
    const g = new DefenseGame('normal', 1);
    expect(g.slots).toHaveLength(SLOTS);
    expect(g.slots.every((s) => s === null)).toBe(true);
    expect(g.cash).toBe(B.startMoney);
    expect(g.status).toBe('prep');
    g.advance(10_000);
    expect(g.waveMs).toBe(0);
    expect(g.incidents).toHaveLength(0);
    expect(g.cash).toBe(B.startMoney);
  });

  it('예보의 사고 수는 곡마다 자아 설정과 같고, 일반에는 정전이 없고 어둠에는 있다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      const g = new DefenseGame(persona, 77);
      let blackouts = 0;
      for (let w = 0; w < B.waves.length; w++) {
        const f = g.forecast();
        expect(INCIDENT_IDS.reduce((a, k) => a + f[k], 0)).toBe(B.persona[persona].counts[w]);
        blackouts += f.blackout;
        if (w < B.waves.length - 1) idleWave(g);
      }
      if (persona === 'normal') expect(blackouts).toBe(0);
      else expect(blackouts).toBeGreaterThan(0);
    }
  });

  it('첫 곡은 하울링과 낙하 소품뿐이고 곡이 갈수록 종류가 늘어난다', () => {
    const g = new DefenseGame('normal', 5);
    const f = g.forecast();
    expect(f.spark + f.crasher + f.blackout).toBe(0);
    expect(f.howl).toBeGreaterThan(0);
    expect(f.prop).toBeGreaterThan(0);
    idleWave(g);
    expect(g.forecast().spark).toBeGreaterThan(0);
    expect(g.forecast().crasher).toBe(0);
    idleWave(g);
    expect(g.forecast().crasher).toBeGreaterThan(0);
  });

  it('좌표로 자리를 찾는다', () => {
    expect(slotAt(0.1, GRID_Y + 0.1)).toBe(0);
    expect(slotAt(COLS - 0.1, GRID_Y + 2.9)).toBe(SLOTS - 1);
    expect(slotAt(2.5, LINE_Y)).toBe(-1);
    expect(slotAt(-1, GRID_Y + 0.5)).toBe(-1);
    expect(slotAt(slotX(7), slotY(7))).toBe(7);
  });
});

describe('돌발 사고 막기: 고용과 합치기', () => {
  it('고용하면 비어 있는 첫 자리에 서고 비용이 점점 오른다', () => {
    const g = new DefenseGame('normal', 1);
    const first = g.hireCost;
    expect(first).toBe(B.hireBase);
    expect(g.hire('sound')).toBe(true);
    expect(g.slots[0]).toMatchObject({ role: 'sound', rank: 1 });
    expect(g.cash).toBe(B.startMoney - first);
    expect(g.hireCost).toBe(B.hireBase + B.hireStep);
    g.hire('light');
    expect(g.slots[1]?.role).toBe('light');
    expect(g.hires).toBe(2);
  });

  it('돈이 모자라거나 자리가 없으면 고용하지 못한다', () => {
    const g = new DefenseGame('normal', 1);
    while (g.hire('sound')) {
      /* 살 수 있는 만큼 산다 */
    }
    expect(g.cash).toBeLessThan(g.hireCost);
    const before = g.hires;
    expect(g.hire('stage')).toBe(false);
    expect(g.hires).toBe(before);

    const full = new DefenseGame('normal', 2);
    for (let i = 0; i < SLOTS; i++) stand(full, i, 'sound', 1);
    expect(full.hire('sound')).toBe(false);
  });

  it('같은 직군·같은 직급 둘을 겹치면 한 직급 오르고 끌어온 자리는 빈다', () => {
    const g = new DefenseGame('normal', 1);
    stand(g, 0, 'stage', 1);
    stand(g, 3, 'stage', 1);
    expect(g.findMerge()).toEqual([0, 3]);
    expect(g.move(0, 3)).toBe('merge');
    expect(g.slots[0]).toBeNull();
    expect(g.slots[3]).toMatchObject({ role: 'stage', rank: 2 });
    expect(g.merges).toBe(1);
    expect(g.topRank).toBe(2);
    expect(g.events.some((e) => e.type === 'merge')).toBe(true);
  });

  it('직군이나 직급이 다르면 합쳐지지 않고 자리가 바뀐다. 빈 자리로는 옮긴다', () => {
    const g = new DefenseGame('normal', 1);
    stand(g, 0, 'sound', 1);
    stand(g, 1, 'light', 1);
    stand(g, 2, 'sound', 2);
    expect(g.move(0, 1)).toBe('swap');
    expect(g.slots[0]?.role).toBe('light');
    expect(g.slots[1]?.role).toBe('sound');
    expect(g.move(1, 2)).toBe('swap');
    expect(g.merges).toBe(0);
    expect(g.move(2, 9)).toBe('move');
    expect(g.slots[2]).toBeNull();
    expect(g.slots[9]?.role).toBe('sound');
    expect(g.move(2, 3)).toBeNull();
    expect(g.move(0, 0)).toBeNull();
    expect(g.move(0, SLOTS)).toBeNull();
  });

  it('최고 직급끼리는 합쳐지지 않는다', () => {
    const g = new DefenseGame('normal', 1);
    stand(g, 0, 'sound', B.maxRank);
    stand(g, 1, 'sound', B.maxRank);
    expect(g.findMerge()).toBeNull();
    expect(g.move(0, 1)).toBe('swap');
    expect(g.slots[1]?.rank).toBe(B.maxRank);
  });
});

describe('돌발 사고 막기: 사고와 스태프', () => {
  it('사고에 맞는 직군이 아니면 약하게 때린다', () => {
    const g = new DefenseGame('normal', 1);
    stand(g, 2, 'sound', 1);
    const howl = put(g, 'howl', 2.5, 3);
    const prop = put(g, 'prop', 3.5, 2.5);
    howl.y = 3;
    g.start();
    g.advance(50);
    // 더 많이 내려온 사고(하울링)를 먼저 쏜다
    expect(howl.hp).toBeCloseTo(1e9 - B.roles.sound.dmg * B.counterMult, 3);
    expect(prop.hp).toBe(1e9);
    howl.y = 0;
    prop.y = 3;
    g.advance(500);
    expect(1e9 - prop.hp).toBeCloseTo(B.roles.sound.dmg * B.offMult, 3);
  });

  it('사정거리 밖의 사고는 쏘지 않고, 직급이 오르면 더 멀리 닿는다', () => {
    const g = new DefenseGame('normal', 1);
    stand(g, 2, 'sound', 1);
    const far = put(g, 'howl', 2.5, 0.5);
    g.start();
    g.advance(100);
    expect(shots(g)).toHaveLength(0);
    expect(far.hp).toBe(1e9);
    g.slots[2]!.rank = 3;
    g.advance(100);
    expect(shots(g).length).toBeGreaterThan(0);
  });

  it('직급이 높을수록 세게 때린다', () => {
    const dmgAt = (rank: number) => {
      const g = new DefenseGame('normal', 1);
      stand(g, 2, 'sound', rank);
      const t = put(g, 'howl', 2.5, 3);
      g.start();
      g.advance(50);
      return 1e9 - t.hp;
    };
    expect(dmgAt(2) / dmgAt(1)).toBeCloseTo(B.rankDmg[2], 5);
    expect(dmgAt(4) / dmgAt(1)).toBeCloseTo(B.rankDmg[4], 5);
  });

  it('무대팀은 맞은 사고 둘레의 사고에게도 번진다', () => {
    const g = new DefenseGame('normal', 1);
    stand(g, 2, 'stage', 1);
    const main = put(g, 'prop', 2.5, 3);
    const near = put(g, 'howl', 2.9, 2.8);
    const far = put(g, 'howl', 0.5, 1.5);
    g.start();
    g.advance(50);
    const base = B.roles.stage.dmg;
    expect(1e9 - main.hp).toBeCloseTo(base * B.counterMult, 3);
    expect(1e9 - near.hp).toBeCloseTo(base * B.roles.stage.splashRate * B.offMult, 3);
    expect(far.hp).toBe(1e9);
  });

  it('조명팀에 맞은 사고는 느려진다', () => {
    const g = new DefenseGame('normal', 1);
    stand(g, 2, 'light', 1);
    const hit = put(g, 'spark', 2.5, 3);
    const free = put(g, 'spark', 4.5, 0.2);
    g.start();
    const y0 = hit.y;
    const f0 = free.y;
    g.advance(150);
    expect(hit.slowMs).toBeGreaterThan(0);
    expect(hit.y - y0).toBeLessThan(free.y - f0);
  });

  it('안전팀은 맞은 사고를 뒤로 밀어낸다. 낙하 소품은 못 민다', () => {
    const g = new DefenseGame('normal', 1);
    stand(g, 2, 'safety', 1);
    const crasher = put(g, 'crasher', 2.5, 3);
    g.start();
    g.advance(50);
    expect(crasher.y).toBeLessThan(3);

    const h = new DefenseGame('normal', 1);
    stand(h, 2, 'safety', 1);
    const prop = put(h, 'prop', 2.5, 3);
    h.start();
    h.advance(50);
    expect(prop.y).toBeGreaterThan(3);
  });

  it('정전이 살아 있으면 그 줄 스태프의 공격이 느려진다', () => {
    const g = new DefenseGame('dark', 1);
    stand(g, 2, 'sound', 1);
    stand(g, 4, 'sound', 1);
    put(g, 'blackout', 2.5, 0.6);
    put(g, 'prop', 3.5, 3);
    g.start();
    g.advance(100);
    expect(g.isDark(2)).toBe(true);
    expect(g.isDark(4)).toBe(false);
    g.events.length = 0;
    g.advance(300);
    const per = (slot: number) => shots(g).filter((s) => s.slot === slot).length;
    // 정전 줄(2번 자리)이 멀쩡한 줄(4번 자리)보다 덜 쏜다
    g.advance(2400);
    expect(per(2)).toBeLessThan(per(4));
    g.incidents = [];
    g.advance(100);
    expect(g.isDark(2)).toBe(false);
  });

  it('무대 앞선까지 내려온 사고는 놓친 것으로 센다', () => {
    const g = new DefenseGame('normal', 1);
    put(g, 'prop', 1.5, LINE_Y - 0.01, 100);
    g.start();
    g.advance(100);
    expect(g.leaked).toBe(1);
    expect(g.leakedW[0]).toBe(B.incidents.prop.weight);
    expect(g.blocked).toBe(0);
    expect(g.events.some((e) => e.type === 'leak' && e.kind === 'prop' && e.lane === 1)).toBe(true);
  });

  it('사고를 막으면 예산이 들어오고 무게만큼 막은 비율이 오른다', () => {
    const g = new DefenseGame('normal', 1);
    stand(g, 2, 'sound', 1);
    put(g, 'howl', 2.5, 3, 5);
    g.start();
    const cash0 = g.cash;
    g.advance(100);
    expect(g.blocked).toBe(1);
    expect(g.blockedW[0]).toBe(B.incidents.howl.weight);
    expect(g.cash).toBeGreaterThanOrEqual(cash0 + B.incidents.howl.bounty);
    expect(g.events.some((e) => e.type === 'kill')).toBe(true);
    expect(g.incidents.filter((i) => i.kind === 'howl' && i.hp <= 0)).toHaveLength(0);
  });

  it('예산은 공연 중에 시간에 따라 오른다', () => {
    const g = new DefenseGame('normal', 1);
    g.start();
    g.advance(200);
    const c0 = g.cash;
    g.advance(2000);
    expect(g.cash - c0).toBeGreaterThanOrEqual(Math.floor(B.incomePerSec * 2) - 1);
  });
});

describe('돌발 사고 막기: 직접 막기', () => {
  it('가까운 사고를 누르면 피해를 주고, 간격 안에서는 다시 못 누른다', () => {
    const g = new DefenseGame('normal', 1);
    const inc = put(g, 'howl', 2.5, 2);
    g.start();
    expect(g.tap(2.6, 2.1)).toBe(true);
    expect(1e9 - inc.hp).toBeCloseTo(B.tapDmg[0], 5);
    expect(g.taps).toBe(1);
    expect(g.tap(2.5, 2)).toBe(false);
    g.advance(B.tapCdMs + 50);
    expect(g.tap(2.5, 2)).toBe(true);
    expect(g.taps).toBe(2);
  });

  it('멀리 누르면 맞지 않고, 곡이 시작되기 전에는 누를 수 없다', () => {
    const g = new DefenseGame('normal', 1);
    put(g, 'howl', 2.5, 2);
    expect(g.tap(2.5, 2)).toBe(false);
    g.start();
    expect(g.tap(0.2, 4)).toBe(false);
    expect(g.taps).toBe(0);
  });

  it('눌러서 체력이 다하면 막은 것으로 센다', () => {
    const g = new DefenseGame('normal', 1);
    put(g, 'howl', 2.5, 2, 3);
    g.start();
    g.tap(2.5, 2);
    expect(g.blocked).toBe(1);
    expect(g.incidents.some((i) => i.hp <= 0)).toBe(false);
  });
});

describe('돌발 사고 막기: 곡 진행과 점수', () => {
  it('곡이 끝나면 지원금을 받고 다음 곡의 준비 상태가 된다', () => {
    const g = new DefenseGame('normal', 3);
    g.hire('sound');
    expect(g.start()).toBe(true);
    expect(g.start()).toBe(false);
    while (g.playing) g.advance(500);
    expect(g.waveIdx).toBe(1);
    expect(g.status).toBe('prep');
    expect(g.waveMs).toBe(0);
    const prep = g.events.find((e): e is Extract<DefenseEvent, { type: 'prep' }> => e.type === 'prep');
    expect(prep?.stipend).toBe(B.stipend[1]);
    expect(g.events.some((e) => e.type === 'waveEnd')).toBe(true);
    const f = g.forecast();
    expect(INCIDENT_IDS.reduce((a, k) => a + f[k], 0)).toBe(B.persona.normal.counts[1]);
  });

  it('곡은 최소 곡 길이만큼 걸리고, 준비 중에는 시간이 멈춰 있다', () => {
    const g = new DefenseGame('normal', 3);
    g.start();
    g.advance(B.waves[0].ms - 1000);
    expect(g.playing).toBe(true);
    expect(g.remainingMs).toBe(1000);
    while (g.playing) g.advance(250);
    const t = g.elapsedMs;
    g.advance(60_000);
    expect(g.elapsedMs).toBe(t);
  });

  it('마지막 곡이 끝나면 공연이 끝난다', () => {
    const g = new DefenseGame('normal', 3);
    for (let w = 0; w < B.waves.length; w++) idleWave(g);
    expect(g.over).toBe(true);
    expect(g.events.some((e) => e.type === 'end')).toBe(true);
    expect(g.start()).toBe(false);
    expect(g.hire('sound')).toBe(false);
    expect(g.score).toBe(0);
    expect(g.cleared).toBe(false);
  });

  it('곡이 끝나도 정리되지 않은 사고는 overtime 뒤에 놓친 것으로 친다', () => {
    const g = new DefenseGame('normal', 3);
    const stuck = put(g, 'prop', 2.5, 0.5);
    stuck.speed = 0;
    g.start();
    g.advance(B.waves[0].ms + 1000);
    expect(g.playing).toBe(true);
    g.advance(B.overtimeMs + 500);
    expect(g.waveIdx).toBe(1);
    expect(g.leakedW[0]).toBeGreaterThanOrEqual(B.incidents.prop.weight);
  });

  it('열기 점수는 곡별 막은 무게 비율 × 곡당 점수의 합이다', () => {
    const g = new DefenseGame('normal', 3);
    expect(g.score).toBe(0);
    g.blockedW[0] = g.totalW[0];
    expect(g.score).toBe(B.waveScore);
    g.totalW[1] = 10;
    g.blockedW[1] = 5;
    expect(g.score).toBe(B.waveScore + Math.round(B.waveScore * 0.5));
    g.blockedW[1] = 99;
    expect(g.waveRatio(1)).toBe(1);
  });

  it('클리어는 열기 점수 600으로 정한다', () => {
    const g = new DefenseGame('normal', 3);
    for (let w = 0; w < 4; w++) g.totalW[w] = 100;
    g.blockedW = [100, 100, 39, 0];
    expect(g.score).toBe(598);
    expect(g.cleared).toBe(false);
    g.blockedW = [100, 100, 40, 0];
    expect(g.score).toBe(600);
    expect(g.cleared).toBe(true);
  });

  it('결과 요약에 막은 수·놓친 수·고용·승급·최고 직급이 담긴다', () => {
    const g = new DefenseGame('normal', 8);
    bot(g, 400);
    const s = g.summary;
    expect(s.blocked).toBe(g.blocked);
    expect(s.leaked).toBe(g.leaked);
    expect(s.blocked + s.leaked).toBe(B.persona.normal.counts.reduce((a, b) => a + b, 0));
    expect(s.hires).toBe(g.hires);
    expect(s.merges).toBeGreaterThan(0);
    expect(s.topRank).toBeGreaterThanOrEqual(2);
    expect(s.waves).toHaveLength(4);
    expect(s.seconds).toBeGreaterThan(80);
  });
});

describe('돌발 사고 막기: 난이도와 재현성', () => {
  it('같은 씨앗·같은 조작이면 항상 같은 판이다', () => {
    const run = () => {
      const g = new DefenseGame('normal', 12345);
      bot(g, 400);
      return { score: g.score, summary: g.summary, cash: g.cash };
    };
    expect(run()).toEqual(run());
  });

  it('씨앗이 다르면 사고가 나오는 순서와 줄이 다르다', () => {
    const order = (seed: number) => {
      const g = new DefenseGame('normal', seed);
      g.start();
      const kinds: string[] = [];
      for (let i = 0; i < 400; i++) {
        g.advance(50);
        for (const e of g.events.splice(0)) if (e.type === 'spawn') kinds.push(e.kind);
      }
      return kinds.join(',');
    };
    expect(order(1)).not.toBe(order(2));
  });

  it('가만히 있으면 0점, 누르기만 해서는 클리어하지 못한다', () => {
    const idle = new DefenseGame('normal', 4);
    for (let w = 0; w < 4; w++) idleWave(idle);
    expect(idle.score).toBe(0);

    const tapper = new DefenseGame('normal', 4);
    let guard = 0;
    while (!tapper.over && guard++ < 5000) {
      if (tapper.status === 'prep') {
        tapper.start();
        continue;
      }
      const front = tapper.incidents.reduce<Incident | null>((b, i) => (!b || i.y > b.y ? i : b), null);
      if (front) tapper.tap(front.x, front.y);
      tapper.advance(300);
    }
    expect(tapper.cleared).toBe(false);
  });

  it('예보를 보고 고용·합치기·직접 막기를 하면 클리어하고, 합치지 않고 고용만 하면 못 한다', () => {
    let clears = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = new DefenseGame('normal', seed * 7919);
      bot(g, 400);
      if (g.cleared) clears += 1;
    }
    expect(clears).toBeGreaterThanOrEqual(5);

    let lazy = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = new DefenseGame('normal', seed * 7919);
      let guard = 0;
      while (!g.over && guard++ < 5000) {
        if (g.status === 'prep') {
          while (g.freeSlot() >= 0 && g.hire('sound')) {
            /* 합치지 않고 음향만 산다 */
          }
          g.start();
          continue;
        }
        g.advance(400);
      }
      if (g.cleared) lazy += 1;
    }
    expect(lazy).toBe(0);
  });

  it('어둠 판도 같은 방식으로 클리어할 수 있다', () => {
    let clears = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = new DefenseGame('dark', seed * 7919);
      bot(g, 400);
      if (g.cleared) clears += 1;
    }
    expect(clears).toBeGreaterThanOrEqual(4);
  });
});

describe('중대형 공연장 직접 공연 연결', () => {
  const ready = () => {
    const s = createInitialState(T0);
    const cleared = { cleared: true, bestScore: 0, cooldownUntil: 0 };
    return { ...s, fans: 1_000_000, concerts: { ...s.concerts, room: cleared, club: cleared, hall: cleared, solo: cleared, medium: cleared } };
  };

  it('중대형 공연장만 돌발 사고 막기이고 대형 콘서트는 무대 서바이버다', () => {
    expect(manualGameOf('large')).toBe('defense');
    expect(manualGameOf('medium')).toBe('bounce');
    expect(manualGameOf('arena')).toBe('survivor');
    expect(manualGameOf('world')).toBe('prestige');
  });

  it('직접 공연을 시작하면 돌발 사고 막기로 쿨다운이 확정된다', () => {
    const begin = beginManualConcert(ready(), 'large', 'd1');
    if (!begin.ok) throw new Error('begin failed');
    expect(begin.run.game).toBe('defense');
    expect(begin.state.concerts.large.cooldownUntil).toBe(T0 + BALANCE.concert.cooldownMs);
    expect(beginManualConcert(begin.state, 'large', 'd2').ok).toBe(false);
  });

  it('보상: 어둠은 2배, 클리어하지 못하면 절반', () => {
    expect(manualConcertReward(1200, 1000, 'normal', 'defense', true)).toBe(2400);
    expect(manualConcertReward(1200, 1000, 'dark', 'defense', true)).toBe(4800);
    expect(manualConcertReward(1200, 1000, 'normal', 'defense', false)).toBe(1200);
  });

  it('클리어는 열기 점수 600으로 정한다', () => {
    const begin = beginManualConcert(ready(), 'large', 'd3');
    if (!begin.ok) throw new Error('begin failed');
    const won = finishManualConcert(begin.state, begin.run, 600);
    expect(won.ok && won.outcome.cleared).toBe(true);
    expect(won.ok && won.state.concerts.large.cleared).toBe(true);
    expect(won.ok && won.outcome.coins).toBe(manualConcertReward(1200, 600, 'normal', 'defense') + 18000);

    const begin2 = beginManualConcert(ready(), 'large', 'd4');
    if (!begin2.ok) throw new Error('begin failed');
    const lost = finishManualConcert(begin2.state, begin2.run, 599);
    expect(lost.ok && lost.outcome.cleared).toBe(false);
    expect(lost.ok && lost.state.concerts.large.cleared).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { BALANCE, manualGameOf } from '../balance';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { GalaxyGame, LINE_COLORS, SHAPE_COUNT, buildStations, type GalaxyEvent } from '../galaxy';
import { createInitialState } from '../persistence';

const B = BALANCE.galaxy;
const T0 = 1_700_000_000_000;
const evs = (g: GalaxyGame, type: GalaxyEvent['type']) => g.events.filter((e) => e.type === type);
const WAVE_MS = B.waves[0].ms;

describe('은하 노선 잇기: 지도', () => {
  it('정거장 9곳이 시드로 정해지고 같은 씨앗이면 같다', () => {
    const a = buildStations(1234);
    expect(a).toHaveLength(B.stationAt.length);
    expect(buildStations(1234)).toEqual(a);
    expect(buildStations(1235)).not.toEqual(a);
  });

  it('처음 셋은 모양이 서로 다르고 지도 안에서 서로 떨어져 있고 ★은 6번째부터다', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = buildStations(seed * 977);
      expect(new Set(s.slice(0, 3).map((p) => p.shape)).size).toBe(3);
      expect(s[B.starAt].shape).toBe(3);
      for (const [i, p] of s.entries()) {
        if (i !== B.starAt) expect(p.shape).toBeLessThan(3);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(B.width);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(B.height);
        for (let j = i + 1; j < s.length; j++) expect(Math.hypot(p.x - s[j].x, p.y - s[j].y)).toBeGreaterThan(40);
      }
    }
  });

  it('정거장은 정해진 시각에 나타난다', () => {
    const g = new GalaxyGame('normal', 7);
    expect(g.shownStations).toHaveLength(3);
    g.advance(B.stationAt[3] - 50);
    expect(g.shownStations).toHaveLength(3);
    g.advance(100);
    expect(g.shownStations).toHaveLength(4);
    expect(evs(g, 'station')).toHaveLength(1);
  });
});

describe('은하 노선 잇기: 관객', () => {
  it('관객은 자기 정거장과 다른 모양을 가고 싶어 하고, 프레임 길이와 상관없이 같은 관객이 같은 때 나온다', () => {
    const a = new GalaxyGame('normal', 99);
    const b = new GalaxyGame('normal', 99);
    for (let t = 0; t < 30_000; t += 50) a.advance(50);
    for (let t = 0; t < 30_000; t += 125) b.advance(125);
    expect(b.elapsedMs).toBe(a.elapsedMs);
    expect(b.stations.map((s) => s.queue)).toEqual(a.stations.map((s) => s.queue));
    expect(a.spawned).toBeGreaterThan(20);
    for (const s of a.shownStations) for (const dest of s.queue) expect(dest).not.toBe(s.shape);
  });

  it('플레이어가 무엇을 하든 관객이 생기는 때와 목적지는 바뀌지 않는다', () => {
    const idle = new GalaxyGame('normal', 5);
    const busy = new GalaxyGame('normal', 5);
    busy.connect(0, 1);
    for (let t = 0; t < 20_000; t += 50) {
      idle.advance(50);
      busy.advance(50);
    }
    expect(busy.spawned).toBe(idle.spawned);
  });
});

describe('은하 노선 잇기: 노선', () => {
  it('두 정거장을 이으면 새 노선이 생기고 셔틀이 한 대 같이 생긴다', () => {
    const g = new GalaxyGame('normal', 3);
    const r = g.connect(0, 1);
    expect(r).toEqual({ ok: true, kind: 'new', lineId: 0 });
    expect(g.lines).toHaveLength(1);
    expect(g.lines[0].stations).toEqual([0, 1]);
    expect(g.lines[0].shuttles).toHaveLength(1);
    expect(g.networkParts).toBe(1);
  });

  it('나타나지 않은 정거장·같은 정거장은 못 잇는다', () => {
    const g = new GalaxyGame('normal', 3);
    expect(g.connect(0, 5)).toEqual({ ok: false, reason: 'invalid' });
    expect(g.connect(0, 0)).toEqual({ ok: false, reason: 'invalid' });
    expect(g.connect(-1, 1)).toEqual({ ok: false, reason: 'invalid' });
    expect(g.lines).toHaveLength(0);
  });

  it('노선의 끝 정거장에서 이으면 그 노선이 늘어나고, 앞쪽을 늘리면 셔틀 번호가 맞춰진다', () => {
    const g = new GalaxyGame('normal', 3);
    g.connect(0, 1);
    expect(g.connect(1, 2)).toEqual({ ok: true, kind: 'extend', lineId: 0 });
    expect(g.lines[0].stations).toEqual([0, 1, 2]);
    const before = g.lines[0].shuttles[0].i0;
    g.advance(B.stationAt[3] + 50);
    expect(g.connect(0, 3)).toEqual({ ok: true, kind: 'extend', lineId: 0 });
    expect(g.lines[0].stations).toEqual([3, 0, 1, 2]);
    expect(g.lines[0].shuttles[0].i0).toBeGreaterThanOrEqual(before);
    expect(g.lines).toHaveLength(1);
  });

  it('이미 노선에 있는 정거장으로는 늘릴 수 없고, 가운데 정거장에서는 늘릴 수 없다', () => {
    const g = new GalaxyGame('normal', 3);
    g.connect(0, 1);
    g.connect(1, 2);
    expect(g.connect(2, 0, { lineId: 0 })).toEqual({ ok: false, reason: 'already' });
    expect(g.connect(1, 0, { lineId: 0 })).toEqual({ ok: false, reason: 'already' });
    expect(g.connect(1, 9, { lineId: 0 })).toEqual({ ok: false, reason: 'invalid' });
    expect(g.connect(0, 1, { lineId: 99 })).toEqual({ ok: false, reason: 'no_line' });
  });

  it('노선의 끝에서 같은 노선의 정거장으로 끌면 새 노선이 생기지 않고 막힌다', () => {
    const g = new GalaxyGame('normal', 3);
    g.connect(0, 1);
    g.connect(1, 2);
    expect(g.connect(2, 0)).toEqual({ ok: false, reason: 'already' });
    expect(g.lines).toHaveLength(1);
    // 끝이 아닌 정거장에서 시작하면 새 노선이다
    expect(g.connect(1, 0)).toEqual({ ok: true, kind: 'new', lineId: 1 });
  });

  it('newLine이면 끝 정거장에서도 새 노선을 만들고 노선 한도와 색을 지킨다', () => {
    const g = new GalaxyGame('normal', 3);
    g.connect(0, 1);
    expect(g.connect(1, 2, { newLine: true })).toEqual({ ok: true, kind: 'new', lineId: 1 });
    expect(g.lines.map((l) => l.color)).toEqual([0, 1]);
    expect(B.maxLines[0]).toBe(2);
    expect(g.connect(0, 2, { newLine: true })).toEqual({ ok: false, reason: 'no_slot' });
    expect(g.removeLine(0)).toBe(true);
    expect(g.connect(0, 2, { newLine: true })).toEqual({ ok: true, kind: 'new', lineId: 2 });
    expect(g.lines.map((l) => l.color)).toEqual([1, 0]);
    expect(g.lines.every((l) => l.color < LINE_COLORS)).toBe(true);
  });

  it('예비 셔틀은 곡이 시작할 때 생기고 노선당 한도까지 붙인다', () => {
    const g = new GalaxyGame('normal', 3);
    expect(g.spare).toBe(B.spareShuttles[0]);
    g.connect(0, 1);
    expect(g.addShuttle(0)).toBe(true);
    expect(g.spare).toBe(0);
    expect(g.lines[0].shuttles).toHaveLength(2);
    expect(g.addShuttle(0)).toBe(false); // 예비가 없다
    g.advance(WAVE_MS + 50);
    expect(g.spare).toBe(B.spareShuttles[1]);
    expect(g.addShuttle(0)).toBe(true);
    expect(g.addShuttle(7)).toBe(false); // 없는 노선
    for (let w = 0; w < 3; w++) {
      g.advance(WAVE_MS);
      while (g.spare > 0 && g.addShuttle(0)) {
        /* 한도까지 */
      }
    }
    expect(g.lines[0].shuttles.length).toBeLessThanOrEqual(B.maxShuttles);
  });

  it('노선을 걷으면 셔틀이 태운 관객은 마지막 정거장 대기열로 돌아온다', () => {
    const g = new GalaxyGame('normal', 3);
    g.stations[0].queue = [g.stations[1].shape, g.stations[1].shape];
    g.connect(0, 1);
    expect(g.lines[0].shuttles[0].load).toHaveLength(2);
    expect(g.stations[0].queue).toHaveLength(0);
    expect(g.removeLine(0)).toBe(true);
    expect(g.lines).toHaveLength(0);
    expect(g.stations[0].queue).toHaveLength(2);
    expect(g.removeLine(0)).toBe(false);
  });
});

describe('은하 노선 잇기: 운행', () => {
  it('목적지 모양의 정거장에 닿으면 도착이다', () => {
    const g = new GalaxyGame('normal', 11);
    g.stations[0].queue = [g.stations[1].shape];
    g.connect(0, 1);
    const spawnedBefore = g.spawned;
    for (let t = 0; t < 12_000 && g.delivered === 0; t += 50) g.advance(50);
    expect(g.delivered).toBeGreaterThanOrEqual(1);
    expect(evs(g, 'deliver').length).toBe(g.delivered);
    expect(g.spawned).toBeGreaterThanOrEqual(spawnedBefore);
  });

  it('한 노선으로 여러 정거장을 지나 목적지에 닿는다', () => {
    const g = new GalaxyGame('normal', 11);
    g.stations[0].queue = [g.stations[2].shape];
    g.connect(0, 1);
    g.connect(1, 2);
    expect(g.lines).toHaveLength(1);
    for (let t = 0; t < 18_000 && g.delivered === 0; t += 50) g.advance(50);
    expect(g.delivered).toBeGreaterThanOrEqual(1);
  });

  it('노선이 갈라져 있으면 갈아타서 도착하고 갈아탄 횟수가 센다', () => {
    const g = new GalaxyGame('normal', 11);
    g.stations[0].queue = [g.stations[2].shape];
    g.connect(0, 1);
    g.connect(1, 2, { newLine: true });
    expect(g.lines).toHaveLength(2);
    expect(g.networkParts).toBe(1);
    for (let t = 0; t < 22_000 && g.transfers === 0; t += 50) g.advance(50);
    expect(g.transfers).toBeGreaterThanOrEqual(1);
    for (let t = 0; t < 22_000 && g.delivered === 0; t += 50) g.advance(50);
    expect(g.delivered).toBeGreaterThanOrEqual(1);
  });

  it('가는 길이 없는 관객은 타지 않고 기다린다', () => {
    const g = new GalaxyGame('normal', 11);
    g.stations[0].queue = [g.stations[2].shape];
    g.connect(0, 1);
    expect(g.nextHop(0, g.stations[2].shape)).toBeNull();
    expect(g.nextHop(0, g.stations[1].shape)).toBe(1);
    expect(g.lines[0].shuttles[0].load).toHaveLength(0);
    expect(g.stations[0].queue).toContain(g.stations[2].shape);
  });

  it('셔틀은 정원까지만 태운다', () => {
    const g = new GalaxyGame('normal', 11);
    g.stations[0].queue = Array.from({ length: 9 }, () => g.stations[1].shape);
    g.connect(0, 1);
    expect(g.lines[0].shuttles[0].load).toHaveLength(B.shuttleCap);
    expect(g.stations[0].queue).toHaveLength(9 - B.shuttleCap);
  });

  it('셔틀은 끝에서 되돌아 왕복한다', () => {
    const g = new GalaxyGame('normal', 11);
    g.connect(0, 1);
    const sh = g.lines[0].shuttles[0];
    const dirs = new Set<number>();
    for (let t = 0; t < 30_000; t += 50) {
      g.advance(50);
      dirs.add(sh.dir);
    }
    expect(dirs).toEqual(new Set([1, -1]));
    const p = g.shuttlePos(g.lines[0], sh);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('은하 노선 잇기: 붐빔', () => {
  it('정원을 넘은 채 시간이 지나면 불만이 터져 대기가 줄고 그 곡 열기가 깎인다', () => {
    const g = new GalaxyGame('normal', 21);
    const cap = g.cap;
    g.stations[0].queue = Array.from({ length: cap + 3 }, () => 1);
    let t = 0;
    for (; t < B.overMs + 1_000 && g.complaints === 0; t += 50) g.advance(50);
    expect(t).toBeGreaterThanOrEqual(B.overMs - 100);
    expect(g.complaints).toBe(1);
    expect(g.complaintsByWave[0]).toBe(1);
    expect(g.stations[0].queue).toHaveLength(Math.floor(cap / 2));
    expect(evs(g, 'complaint')).toHaveLength(1);
  });

  it('정원 안으로 돌아오면 붐빔 시간은 줄어든다', () => {
    const g = new GalaxyGame('normal', 21);
    g.stations[1].queue = Array.from({ length: g.cap + 1 }, () => 0);
    g.advance(2_000);
    expect(g.stations[1].over).toBeGreaterThan(0);
    const mid = g.stations[1].over;
    g.stations[1].queue = [];
    g.advance(1_000);
    expect(g.stations[1].over).toBeLessThan(mid);
  });

  it('어둠은 정원이 더 작다', () => {
    expect(new GalaxyGame('dark', 1).cap).toBeLessThan(new GalaxyGame('normal', 1).cap);
  });
});

describe('은하 노선 잇기: 곡과 점수', () => {
  it('곡이 끝나면 점수 비율이 확정되고 다음 곡으로 넘어가며 노선 한도·예비 셔틀이 늘어난다', () => {
    const g = new GalaxyGame('normal', 31);
    g.advance(WAVE_MS);
    expect(g.waveIdx).toBe(1);
    expect(g.ratios).toHaveLength(1);
    expect(evs(g, 'waveEnd')).toHaveLength(1);
    expect(evs(g, 'wave')).toHaveLength(1);
    expect(g.maxLines).toBe(B.maxLines[1]);
    expect(g.spare).toBe(B.spareShuttles[0] + B.spareShuttles[1]);
    expect(evs(g, 'grant').length).toBeGreaterThanOrEqual(2);
  });

  it('아무것도 안 하면 0점이고 네 곡이 끝나면 끝난다', () => {
    const g = new GalaxyGame('normal', 31);
    for (let w = 0; w < B.waves.length; w++) g.advance(WAVE_MS);
    expect(g.over).toBe(true);
    expect(g.status).toBe('finished');
    expect(evs(g, 'end')).toHaveLength(1);
    expect(g.score).toBe(0);
    expect(g.cleared).toBe(false);
    expect(g.summary.waves).toEqual([0, 0, 0, 0]);
    expect(g.summary.seconds).toBe(Math.round((WAVE_MS * B.waves.length) / 1000));
    g.advance(5_000);
    expect(g.elapsedMs).toBe(WAVE_MS * B.waves.length);
    expect(g.connect(0, 1)).toEqual({ ok: false, reason: 'over' });
  });

  it('곡 점수 비율 = (도착 − 불만 × 감점) ÷ 목표, 0~1', () => {
    const g = new GalaxyGame('normal', 31);
    const goal = g.goal;
    g.deliveredByWave[0] = Math.floor(goal / 2);
    expect(g.waveRatio(0)).toBeCloseTo(Math.floor(goal / 2) / goal, 9);
    g.deliveredByWave[0] = goal * 3;
    expect(g.waveRatio(0)).toBe(1);
    g.deliveredByWave[0] = goal;
    g.complaintsByWave[0] = 2;
    expect(g.heat).toBe(goal - 2 * B.complaintFans);
    expect(g.waveRatio(0)).toBeCloseTo((goal - 2 * B.complaintFans) / goal, 9);
    g.complaintsByWave[0] = 99;
    expect(g.heat).toBe(0);
    expect(g.waveRatio(1)).toBe(0); // 아직 시작 안 한 곡
  });

  it('열기 점수는 곡별 250 × 비율의 합이고 600 이상이 클리어다', () => {
    const g = new GalaxyGame('normal', 31);
    g.ratios = [1, 1, 0.5];
    g.waveIdx = 3;
    g.deliveredByWave[3] = 0;
    expect(g.score).toBe(Math.round(B.waveScore * 2.5));
    expect(g.cleared).toBe(true);
    g.ratios = [1, 1, 0.3];
    expect(g.score).toBe(Math.round(B.waveScore * 2.3));
    expect(g.cleared).toBe(false);
  });

  it('잘 이으면 클리어하고 못 이으면 못 한다: 셔틀을 붙이며 모든 정거장을 잇는 단순한 플레이', () => {
    const play = (seed: number, effort: boolean) => {
      const g = new GalaxyGame('normal', seed);
      let nextAct = 1000;
      while (!g.over) {
        g.advance(50);
        if (effort && g.elapsedMs >= nextAct) {
          nextAct += 1500;
          const inNet = new Set(g.lines.flatMap((l) => l.stations));
          if (g.spare > 0 && g.lines.length) {
            const busiest = [...g.lines].sort((a, b) => b.stations.reduce((s, id) => s + g.stations[id].queue.length, 0) - a.stations.reduce((s, id) => s + g.stations[id].queue.length, 0))[0];
            if (g.addShuttle(busiest.id)) continue;
          }
          const loose = g.shownStations.filter((s) => !inNet.has(s.id));
          if (g.lines.length === 0) g.connect(0, 1);
          else if (loose.length) {
            const u = loose[0];
            let best: { e: number; line: number; d: number } | null = null;
            for (const l of g.lines) for (const e of [l.stations[0], l.stations[l.stations.length - 1]]) {
              const d = Math.hypot(g.stations[e].x - u.x, g.stations[e].y - u.y);
              if (!best || d < best.d) best = { e, line: l.id, d };
            }
            if (best) g.connect(best.e, u.id, { lineId: best.line });
          }
        }
      }
      return g;
    };
    const wins = [1, 2, 3, 4, 5, 6].filter((i) => play(i * 977, true).cleared).length;
    expect(wins).toBeGreaterThanOrEqual(4);
    expect(play(977, false).cleared).toBe(false);
  });

  it('같은 씨앗·같은 조작이면 결과가 같다', () => {
    const run = () => {
      const g = new GalaxyGame('dark', 4242);
      g.connect(0, 1);
      g.connect(1, 2);
      g.advance(40_000);
      g.addShuttle(0);
      g.advance(60_000);
      return { score: g.score, delivered: g.delivered, spawned: g.spawned, complaints: g.complaints, waves: g.summary.waves };
    };
    expect(run()).toEqual(run());
  });
});

describe('은하 노선 잇기: 공연장 연결', () => {
  it('유니버스 페스티벌(universe)이 이 게임이다', () => {
    expect(manualGameOf('universe')).toBe('galaxy');
    expect(SHAPE_COUNT).toBe(4);
  });

  it('월클을 클리어하고 팬 50만이면 일반·어둠 모두 시작할 수 있다', () => {
    const s = createInitialState(T0);
    const open = { ...s, fans: 500_000, concerts: { ...s.concerts, world: { ...s.concerts.world, cleared: true } } };
    const r = beginManualConcert(open, 'universe', 'g1');
    expect(r.ok).toBe(true);
    expect(r.ok && r.run.game).toBe('galaxy');
    const dark = beginManualConcert({ ...open, activePersona: 'dark' as const }, 'universe', 'g2');
    expect(dark.ok).toBe(true);
    const poor = beginManualConcert({ ...open, fans: 499_999 }, 'universe', 'g3');
    expect(!poor.ok && poor.reason).toBe('locked');
  });

  it('보상은 일반 ×1·어둠 ×2이고 클리어하면 첫 클리어 코인·다이아가 붙는다', () => {
    expect(B.persona.normal.rewardMult).toBe(1);
    expect(B.persona.dark.rewardMult).toBe(2);
    expect(manualConcertReward(20_000, 1000, 'normal', 'galaxy')).toBe(20_000 * 2 * 1);
    expect(manualConcertReward(20_000, 1000, 'dark', 'galaxy')).toBe(20_000 * 2 * 2);
    const s = createInitialState(T0);
    const open = { ...s, fans: 500_000, concerts: { ...s.concerts, world: { ...s.concerts.world, cleared: true } } };
    const begin = beginManualConcert(open, 'universe', 'g1');
    if (!begin.ok) throw new Error('begin failed');
    const fin = finishManualConcert(begin.state, begin.run, 800);
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(fin.outcome).toMatchObject({ cleared: true, firstClear: true, diamonds: 120, firstClearCoins: 400_000 });
  });
});

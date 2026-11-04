import { describe, expect, it } from 'vitest';
import { BALANCE, manualGameOf } from '../balance';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { createInitialState } from '../persistence';
import { mulberry32 } from '../runner';
import { COLS, StonesGame, makeRow, type Cell, type StonesEvent } from '../stones';

const B = BALANCE.stones;
const T0 = 1_700_000_000_000;
const evs = (g: StonesGame, type: StonesEvent['type']) => g.events.filter((e) => e.type === type);
const stand = (c: Cell) => c !== 'water';
const safe = (c: Cell) => c === 'stone' || c === 'lotus';

/** 앞 줄을 원하는 모양으로 바꿔 놓는다 */
function setRows(g: StonesGame, rows: Cell[][]): void {
  rows.forEach((r, i) => (g.rows[g.row + 1 + i] = r));
}
/** 곡 시간을 박자 위상(ms)에 맞춘다: 박자 길이로 나눈 나머지가 phase가 되게 다음 박 근처로 보낸다 */
function toPhase(g: StonesGame, phase: number): void {
  const beat = g.beatMs;
  const cur = g.waveMs % beat;
  g.advance(phase >= cur ? phase - cur : beat - cur + phase);
}

describe('삼도천 징검다리: 줄 만들기', () => {
  it('어느 설 수 있는 칸에서도 다음 줄의 발판으로 이어진다(막다른 길 없음)', () => {
    for (let s = 1; s <= 40; s++) {
      const g = new StonesGame('dark', s);
      for (let i = 0; i < 150; i++) g.rows.push(makeRow(g.rows[g.rows.length - 1], g.rows.length, mulberry32(s * 997 + i)));
      for (let r = 0; r + 1 < g.rows.length; r++) {
        const prev = g.rows[r];
        const next = g.rows[r + 1];
        expect(next.some(safe)).toBe(true);
        for (let c = 0; c < COLS; c++) {
          if (!stand(prev[c])) continue;
          expect([c - 1, c, c + 1].some((d) => d >= 0 && d < COLS && safe(next[d]))).toBe(true);
        }
      }
    }
  });

  it('줄이 내려갈수록 돌이 하나뿐인 줄이 늘고, 도깨비불은 fireFrom줄부터만 나온다', () => {
    let early = 0;
    let late = 0;
    let fireEarly = 0;
    let fireLate = 0;
    for (let s = 1; s <= 60; s++) {
      const g = new StonesGame('dark', s);
      for (let i = 0; i < 120; i++) g.rows.push(makeRow(g.rows[g.rows.length - 1], g.rows.length, mulberry32(s * 31 + i)));
      g.rows.forEach((row, r) => {
        const singles = row.filter(safe).length === 1;
        const fire = row.includes('fire');
        if (r >= 1 && r < 15) {
          if (singles) early++;
          if (fire) fireEarly++;
        }
        if (r >= 90) {
          if (singles) late++;
          if (fire) fireLate++;
        }
      });
    }
    expect(fireEarly).toBe(0);
    expect(fireLate).toBeGreaterThan(0);
    expect(late / 30).toBeGreaterThan(early / 14);
  });

  it('같은 씨앗이면 같은 강, 앞쪽은 미리 만들어 둔다', () => {
    const a = new StonesGame('dark', 5);
    const b = new StonesGame('dark', 5);
    expect(a.rows).toEqual(b.rows);
    expect(a.rows.length).toBeGreaterThan(B.ahead);
    expect(new StonesGame('dark', 6).rows).not.toEqual(a.rows);
  });
});

describe('삼도천 징검다리: 뛰기', () => {
  it('처음에는 0줄 가운데 칸, 하트 가득, 물은 startGap줄 뒤다', () => {
    const g = new StonesGame('dark', 1);
    expect(g.row).toBe(0);
    expect(g.col).toBe(1);
    expect(g.hearts).toBe(B.hearts);
    expect(g.gap).toBe(B.startGap);
    expect(g.score).toBe(0);
    expect(g.status).toBe('running');
  });

  it('돌 위로 뛰면 한 줄 앞으로 가고 박자가 맞으면 perfect 점수를 받는다', () => {
    const g = new StonesGame('dark', 1);
    setRows(g, [['water', 'stone', 'water']]);
    expect(g.grade).toBe('perfect');
    expect(g.hop(1)).toBe(true);
    expect(g.row).toBe(1);
    expect(g.points[0]).toBe(B.hopPoints.perfect);
    expect(g.onBeatHops).toBe(1);
    expect(g.streak).toBe(1);
    const hop = evs(g, 'hop')[0] as Extract<StonesEvent, { type: 'hop' }>;
    expect(hop).toMatchObject({ row: 1, col: 1, grade: 'perfect', points: 2 });
  });

  it('박자 판정: 가까우면 perfect, 조금 벗어나면 good, 많이 벗어나면 삐끗(−1, 0 아래로는 안 내려간다)', () => {
    const beat = new StonesGame('dark', 1).beatMs;
    const at = (phase: number) => {
      const g = new StonesGame('dark', 1);
      g.advance(beat * 2);
      toPhase(g, phase);
      return g.grade;
    };
    expect(at(beat * B.beatWindow * 0.5)).toBe('perfect');
    expect(at(beat * B.beatWindow * 1.5)).toBe('good');
    expect(at(beat * 0.5)).toBe('off');
    expect(at(beat - 1)).toBe('perfect');

    const g = new StonesGame('dark', 1);
    setRows(g, [['water', 'stone', 'water']]);
    toPhase(g, beat * 0.5);
    g.hop(1);
    expect(g.points[0]).toBe(0);
    expect(g.streak).toBe(0);
    expect(g.row).toBe(1);
  });

  it('연꽃은 보너스를 주고 도깨비불은 건너가지만 하트를 잃는다', () => {
    const g = new StonesGame('dark', 1);
    setRows(g, [['water', 'lotus', 'fire'], ['fire', 'stone', 'water']]);
    g.hop(1);
    expect(g.points[0]).toBe(B.hopPoints.perfect + B.lotusBonus);
    expect(g.lotuses).toBe(1);
    g.advance(g.beatMs * 2);
    // 옆 도깨비불 칸으로 건너간다
    toPhase(g, 0);
    g.advance(g.stunLeftMs + g.lockLeftMs + 1);
    toPhase(g, 0);
    g.hop(0);
    expect(g.row).toBe(2);
    expect(g.hearts).toBe(B.hearts - 1);
    expect(g.burns).toBe(1);
    expect(g.stunned).toBe(true);
    expect(evs(g, 'burn')).toHaveLength(1);
  });

  it('물 칸으로 뛰면 풍덩: 하트 −1, 그 자리에 머물고 한동안 못 움직인다', () => {
    const g = new StonesGame('dark', 1);
    setRows(g, [['stone', 'water', 'water']]);
    g.hop(1);
    expect(g.row).toBe(0);
    expect(g.hearts).toBe(B.hearts - 1);
    expect(g.splashes).toBe(1);
    expect(g.stunned).toBe(true);
    expect(g.hop(0)).toBe(false);
    g.advance(B.swampStunMs + 1);
    expect(g.stunned).toBe(false);
    expect(g.hop(0)).toBe(true);
    expect(g.row).toBe(1);
  });

  it('뛴 직후에는 한 박 × hopLock 동안 입력을 무시한다', () => {
    const g = new StonesGame('dark', 1);
    setRows(g, [['water', 'stone', 'water'], ['water', 'stone', 'water']]);
    expect(g.hop(1)).toBe(true);
    expect(g.hop(1)).toBe(false);
    expect(g.row).toBe(1);
    g.advance(g.beatMs * B.hopLock + 1);
    expect(g.hop(1)).toBe(true);
    expect(g.row).toBe(2);
  });

  it('한 번에 옆 칸까지만 간다: 먼 칸을 누르면 그쪽으로 한 칸', () => {
    const g = new StonesGame('dark', 1);
    g.col = 0;
    setRows(g, [['stone', 'stone', 'stone']]);
    g.hop(2);
    expect(g.col).toBe(1);
  });
});

describe('삼도천 징검다리: 물살과 곡 진행', () => {
  it('쫓아오는 물이 내 줄에 닿으면 하트 −1, 물은 sweptGap줄 뒤로 물러난다', () => {
    const g = new StonesGame('dark', 1);
    g.advance((B.startGap / B.waterSpeed[0]) * 1000 + 100);
    expect(g.sweptCount).toBe(1);
    expect(g.hearts).toBe(B.hearts - 1);
    expect(g.gap).toBeCloseTo(B.sweptGap, 1);
    expect(evs(g, 'swept')).toHaveLength(1);
  });

  it('하트가 다 닳으면 그 자리에서 끝나고, 그때까지의 점수는 인정된다', () => {
    const g = new StonesGame('dark', 1);
    setRows(g, [['water', 'stone', 'water']]);
    g.hop(1);
    const points = g.points[0];
    expect(points).toBeGreaterThan(0);
    g.advance(60_000);
    expect(g.over).toBe(true);
    expect(g.died).toBe(true);
    expect(g.hearts).toBe(0);
    expect(g.ratios).toHaveLength(4);
    expect(g.waveRatio(0)).toBeCloseTo(points / B.goals[0], 5);
    expect(g.score).toBe(Math.round((B.waveScore * points) / B.goals[0]));
    expect(evs(g, 'end')).toHaveLength(1);
  });

  it('곡이 끝나면 다음 곡으로 넘어가 박자가 빨라지고 물도 빨라진다', () => {
    const g = new StonesGame('dark', 1);
    const b0 = g.beatMs;
    g.waterRow = -1000; // 쓸려 가지 않게
    g.advance(B.waves[0].ms + 100);
    expect(g.waveIdx).toBe(1);
    expect(g.beatMs).toBeLessThan(b0);
    expect(g.ratios).toHaveLength(1);
    expect(evs(g, 'wave')).toHaveLength(1);
    expect(evs(g, 'waveEnd')).toHaveLength(1);
  });

  it('박자음이 한 박마다 나오고 네 번에 한 번 강박이다', () => {
    const g = new StonesGame('dark', 1);
    g.waterRow = -1000;
    g.advance(g.beatMs * 8 + 5);
    const beats = evs(g, 'beat') as { type: 'beat'; strong: boolean }[];
    expect(beats.length).toBeGreaterThanOrEqual(8);
    expect(beats.slice(0, 8).map((b) => b.strong)).toEqual([true, false, false, false, true, false, false, false]);
  });

  it('요약에는 도착한 줄·판정·하트가 들어간다', () => {
    const g = new StonesGame('dark', 1);
    setRows(g, [['water', 'stone', 'water']]);
    g.hop(1);
    const s = g.summary;
    expect(s).toMatchObject({ hops: 1, onBeat: 1, rows: 1, heartsLeft: B.hearts, died: false });
    expect(s.waves).toHaveLength(4);
  });
});

describe('삼도천 징검다리: 공연장 연결', () => {
  it('저세상 공연페스티벌(garage)이 이 게임이다', () => {
    expect(manualGameOf('garage')).toBe('stones');
  });

  it('어둠속성이 다크웹 라이브공연을 클리어하고 팬 500만이면 시작할 수 있다', () => {
    const s = createInitialState(T0);
    const done = { cleared: true, bestScore: 0, cooldownUntil: 0 };
    const open = { ...s, fans: 5_000_000, activePersona: 'dark' as const, concerts: { ...s.concerts, world: done, rooftop: done, ruins: done } };
    const r = beginManualConcert(open, 'garage', 't1');
    expect(r.ok && r.run.game).toBe('stones');
    const early = beginManualConcert({ ...open, concerts: { ...open.concerts, ruins: { ...done, cleared: false } } }, 'garage', 't2');
    expect(!early.ok && early.reason).toBe('locked');
    const poor = beginManualConcert({ ...open, fans: 4_999_999 }, 'garage', 't3');
    expect(!poor.ok && poor.reason).toBe('locked');
  });

  it('보상은 어둠 ×2이고 첫 클리어 코인·다이아가 붙는다', () => {
    expect(manualConcertReward(500_000, 1000, 'dark', 'stones')).toBe(500_000 * 2 * 2);
    const s = createInitialState(T0);
    const done = { cleared: true, bestScore: 0, cooldownUntil: 0 };
    const open = { ...s, fans: 5_000_000, activePersona: 'dark' as const, concerts: { ...s.concerts, world: done, rooftop: done, ruins: done } };
    const begin = beginManualConcert(open, 'garage', 't1');
    if (!begin.ok) throw new Error('begin failed');
    const fin = finishManualConcert(begin.state, begin.run, 700);
    expect(fin.ok && fin.outcome).toMatchObject({ cleared: true, firstClear: true, diamonds: 400, firstClearCoins: 10_000_000 });
  });
});

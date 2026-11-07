import { afterEach, describe, expect, it } from 'vitest';
import { closeTempOpenStages, reopenTempOpenStages } from './tempOpen';
import { BALANCE, manualGameOf } from '../balance';
import { BlackoutGame, LANES, beatMsOf, buildWaveNotes, type BlackoutEvent } from '../blackout';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { createInitialState } from '../persistence';

const B = BALANCE.blackout;
const T0 = 1_700_000_000_000;
const evs = (g: BlackoutGame, type: BlackoutEvent['type']) => g.events.filter((e) => e.type === type);

/** 지금 곡의 노트를 전부 정확한 시각에 친다 */
function playWave(g: BlackoutGame, jitter = 0): void {
  const wave = g.waveIdx;
  for (const n of [...g.notes]) {
    g.advance(Math.max(0, n.t + jitter - g.waveMs));
    if (g.waveIdx !== wave) return;
    g.tap(n.lane);
  }
  g.advance(B.waves[wave].ms - g.waveMs + 1);
}

afterEach(reopenTempOpenStages);

describe('정전 속 박자: 채보', () => {
  it('같은 씨앗·곡이면 같은 채보, 씨앗이 다르면 달라진다', () => {
    expect(buildWaveNotes(5, 0)).toEqual(buildWaveNotes(5, 0));
    expect(buildWaveNotes(5, 0)).not.toEqual(buildWaveNotes(6, 0));
    expect(buildWaveNotes(5, 0)).not.toEqual(buildWaveNotes(5, 1));
  });

  it('노트는 첫 노트 시각~곡 끝 전 구간의 8분음표 칸 위에 있고 레인 범위 안이다', () => {
    for (let w = 0; w < B.waves.length; w++) {
      const beat = beatMsOf(w);
      const notes = buildWaveNotes(11, w);
      expect(notes.length).toBeGreaterThan(20);
      for (const n of notes) {
        expect(n.t).toBeGreaterThanOrEqual(B.leadInMs);
        expect(n.t).toBeLessThanOrEqual(B.waves[w].ms - B.tailMs);
        expect(n.lane).toBeGreaterThanOrEqual(0);
        expect(n.lane).toBeLessThan(LANES);
        const slot = (n.t - B.leadInMs) / (beat / 2);
        expect(Math.abs(slot - Math.round(slot))).toBeLessThan(0.01);
      }
    }
  });

  it('곡이 갈수록 노트가 늘고 동시 노트는 뒤 곡에서만 나온다', () => {
    const count = (w: number) => {
      let sum = 0;
      for (let s = 1; s <= 20; s++) sum += buildWaveNotes(s, w).length;
      return sum / 20;
    };
    expect(count(1)).toBeGreaterThan(count(0));
    expect(count(3)).toBeGreaterThan(count(1));
    const doubles = (w: number) => {
      let n = 0;
      for (let s = 1; s <= 30; s++) {
        const notes = buildWaveNotes(s, w);
        n += notes.filter((a, i) => i > 0 && notes[i - 1].t === a.t).length;
      }
      return n;
    };
    expect(doubles(0)).toBe(0);
    expect(doubles(1)).toBe(0);
    expect(doubles(3)).toBeGreaterThan(0);
  });

  it('같은 레인이 한 박 안에 연달아 나오지 않고 노트가 너무 오래 비지 않는다', () => {
    for (let s = 1; s <= 30; s++) {
      for (let w = 0; w < B.waves.length; w++) {
        const beat = beatMsOf(w);
        const notes = buildWaveNotes(s, w);
        let prev: { t: number; lane: number } | null = null;
        for (const n of notes) {
          if (prev && n.t !== prev.t && n.t - prev.t < beat - 1) expect(n.lane).not.toBe(prev.lane);
          if (prev && n.t !== prev.t) expect(n.t - prev.t).toBeLessThanOrEqual(beat / 2 * 4 + 1);
          prev = n;
        }
      }
    }
  });
});

describe('정전 속 박자: 판정', () => {
  it('시작할 때는 콤보 0, 시야는 기본값이다', () => {
    const g = new BlackoutGame('dark', 1);
    expect(g.status).toBe('running');
    expect(g.combo).toBe(0);
    expect(g.lookAheadMs).toBe(B.baseLookMs);
    expect(g.score).toBe(0);
    expect(g.notes.every((n) => n.result === null)).toBe(true);
  });

  it('정확한 시각에 그 레인을 치면 perfect, 판정 폭 끝이면 good이다', () => {
    const g = new BlackoutGame('dark', 1);
    const [a, b] = g.notes;
    g.advance(a.t);
    g.tap(a.lane);
    expect(a.result).toBe('perfect');
    expect(evs(g, 'hit')).toHaveLength(1);
    g.advance(b.t + B.goodMs - 5 - g.waveMs);
    g.tap(b.lane);
    expect(b.result).toBe('good');
    expect(g.perfect).toBe(1);
    expect(g.good).toBe(1);
  });

  it('다른 레인이나 노트가 없는 곳을 치면 헛손질이고 콤보가 끊긴다', () => {
    const g = new BlackoutGame('dark', 1);
    const a = g.notes[0];
    g.advance(a.t);
    g.tap(a.lane);
    expect(g.combo).toBe(1);
    g.tap((a.lane + 1) % LANES);
    expect(g.stray).toBe(1);
    expect(g.combo).toBe(0);
    expect(evs(g, 'stray')).toHaveLength(1);
  });

  it('판정 폭을 지나면 놓친 것(miss)이 되고 콤보가 끊긴다', () => {
    const g = new BlackoutGame('dark', 1);
    const a = g.notes[0];
    g.advance(a.t);
    g.tap(a.lane);
    const b = g.notes[1];
    g.advance(b.t + B.goodMs + 10 - g.waveMs);
    expect(b.result).toBe('miss');
    expect(g.miss).toBe(1);
    expect(g.combo).toBe(0);
    expect(evs(g, 'miss')).toHaveLength(1);
  });

  it('콤보가 쌓일수록 멀리 보이고 comboCap에서 멈춘다', () => {
    const g = new BlackoutGame('dark', 1);
    for (let i = 0; i < B.comboCap + 5; i++) {
      const n = g.notes[i];
      g.advance(Math.max(0, n.t - g.waveMs));
      g.tap(n.lane);
    }
    expect(g.combo).toBeGreaterThan(B.comboCap);
    expect(g.lookAheadMs).toBe(B.baseLookMs + B.lookPerCombo * B.comboCap);
  });

  it('앞 노트를 놓쳐도 같은 레인의 다음 노트는 그대로 칠 수 있다', () => {
    const g = new BlackoutGame('dark', 1);
    const lane = g.notes[0].lane;
    const same = g.notes.filter((n) => n.lane === lane);
    g.advance(same[1].t - g.waveMs);
    g.tap(lane);
    expect(same[0].result).toBe('miss');
    expect(same[1].result).toBe('perfect');
  });
});

describe('정전 속 박자: 박자와 곡 진행', () => {
  it('박자음이 한 박마다 나오고 네 번에 한 번 강박이다', () => {
    const g = new BlackoutGame('dark', 1);
    g.advance(B.leadInMs + beatMsOf(0) * 8 + 1);
    const beats = evs(g, 'beat') as { type: 'beat'; strong: boolean }[];
    expect(beats.length).toBeGreaterThanOrEqual(8);
    expect(beats.filter((b) => b.strong).length).toBeGreaterThanOrEqual(2);
    const strongAt = beats.findIndex((b) => b.strong);
    expect(beats.slice(strongAt, strongAt + 8).map((b) => b.strong)).toEqual([true, false, false, false, true, false, false, false]);
  });

  it('곡이 끝나면 다음 곡으로 넘어가고 노트·박자가 바뀐다', () => {
    const g = new BlackoutGame('dark', 1);
    const first = g.notes.length;
    g.advance(B.waves[0].ms + 100);
    expect(g.waveIdx).toBe(1);
    expect(g.waveMs).toBeCloseTo(100, 5);
    expect(g.ratios).toHaveLength(1);
    expect(evs(g, 'waveEnd')).toHaveLength(1);
    expect(evs(g, 'wave')).toHaveLength(1);
    expect(g.beatMs).toBe(beatMsOf(1));
    expect(g.notes.length).not.toBe(first);
  });

  it('모든 노트를 정확히 치면 곡마다 비율 1, 점수 1000으로 클리어', () => {
    const g = new BlackoutGame('dark', 3);
    while (!g.over) playWave(g);
    expect(g.status).toBe('finished');
    expect(g.ratios).toEqual([1, 1, 1, 1]);
    expect(g.score).toBe(1000);
    expect(g.cleared).toBe(true);
    expect(evs(g, 'end')).toHaveLength(1);
  });

  it('아무것도 안 치면 점수 0, 노트는 전부 놓친 것으로 센다', () => {
    const g = new BlackoutGame('dark', 3);
    g.advance(B.waves.length * B.waves[0].ms + 10);
    expect(g.over).toBe(true);
    expect(g.score).toBe(0);
    expect(g.cleared).toBe(false);
    expect(g.miss).toBe(g.summary.notes);
  });

  it('헛손질이 많으면 점수가 깎이고, 0 아래로는 안 내려간다', () => {
    const clean = new BlackoutGame('dark', 4);
    playWave(clean);
    const noisy = new BlackoutGame('dark', 4);
    const wave = noisy.waveIdx;
    for (const n of [...noisy.notes]) {
      noisy.advance(Math.max(0, n.t - noisy.waveMs));
      noisy.tap(n.lane);
      noisy.tap((n.lane + 1) % LANES);
    }
    noisy.advance(B.waves[wave].ms - noisy.waveMs + 1);
    expect(noisy.ratios[0]).toBeLessThan(clean.ratios[0]);
    const spam = new BlackoutGame('dark', 4);
    for (let i = 0; i < 200; i++) spam.tap(i % LANES);
    expect(spam.waveRatio(0)).toBe(0);
  });

  it('큰 시간 걸음으로도 곡을 건너뛰지 않고 순서대로 처리한다', () => {
    const g = new BlackoutGame('dark', 6);
    g.advance(B.waves[0].ms * 2 + 500);
    expect(g.waveIdx).toBe(2);
    expect(g.waveMs).toBeCloseTo(500, 5);
    expect(g.ratios).toHaveLength(2);
  });

  it('요약에는 곡별 달성률(%)과 판정 횟수가 들어간다', () => {
    const g = new BlackoutGame('dark', 3);
    playWave(g);
    const s = g.summary;
    expect(s.waves).toHaveLength(4);
    expect(s.waves[0]).toBe(100);
    expect(s.perfect).toBeGreaterThan(20);
    expect(s.bestCombo).toBeGreaterThan(20);
  });
});

describe('정전 속 박자: 공연장 연결', () => {
  it('폐건물 지하공연(rooftop)이 이 게임이다', () => {
    expect(manualGameOf('rooftop')).toBe('blackout');
  });

  it('어둠속성이 유니버스 페스티벌을 클리어하고 팬 100만이면 시작할 수 있고, 일반속성은 막힌다', () => {
    closeTempOpenStages(); // 임시 개방과 상관없이 원래 조건을 본다
    const s = createInitialState(T0);
    const open = { ...s, fans: 1_000_000, activePersona: 'dark' as const, concerts: { ...s.concerts, universe: { ...s.concerts.universe, cleared: true } } };
    const r = beginManualConcert(open, 'rooftop', 'b1');
    expect(r.ok).toBe(true);
    expect(r.ok && r.run.game).toBe('blackout');
    const normal = beginManualConcert({ ...open, activePersona: 'normal' }, 'rooftop', 'b2');
    expect(!normal.ok && normal.reason).toBe('dark_only');
    const poor = beginManualConcert({ ...open, fans: 999_999 }, 'rooftop', 'b3');
    expect(!poor.ok && poor.reason).toBe('locked');
  });

  it('보상은 어둠 ×2이고 클리어하면 첫 클리어 코인·다이아가 붙는다', () => {
    const base = BALANCE.blackout.persona.dark.rewardMult;
    expect(base).toBe(2);
    expect(manualConcertReward(60_000, 1000, 'dark', 'blackout')).toBe(60_000 * 2 * 2);
    const s = createInitialState(T0);
    const open = { ...s, fans: 1_000_000, activePersona: 'dark' as const, concerts: { ...s.concerts, universe: { ...s.concerts.universe, cleared: true } } };
    const begin = beginManualConcert(open, 'rooftop', 'b1');
    if (!begin.ok) throw new Error('begin failed');
    const fin = finishManualConcert(begin.state, begin.run, 900);
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(fin.outcome).toMatchObject({ cleared: true, firstClear: true, diamonds: 200, firstClearCoins: 1_200_000 });
  });
});

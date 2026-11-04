import { describe, expect, it } from 'vitest';
import { BALANCE, manualGameOf } from '../balance';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { EFFECT_IDS, HECKLER, MergeGame, SIZE, colorOf, groupAt, levelOf, mergeableCells, type EffectId, type MergeEvent } from '../merge';
import { createInitialState } from '../persistence';

const M = BALANCE.merge;
const T0 = 1_700_000_000_000;

const code = (level: number, color: number) => level * 10 + color;
const at = (r: number, c: number) => r * SIZE + c;
/** 같은 코드끼리 붙은 곳이 없는 바닥: 1단계 색 2·3을 바둑판으로 깐다. 그 위에 색 1이나 다른 단계를 놓으면 묶음을 마음대로 만들 수 있다. */
function blank(seed = 1, persona: 'normal' | 'dark' = 'normal'): MergeGame {
  const g = new MergeGame(persona, seed);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) g.board[at(r, c)] = code(1, (r + c) % 2 === 0 ? 2 : 3);
  g.events.length = 0;
  return g;
}
const put = (g: MergeGame, cells: Array<[number, number]>, v: number) => cells.forEach(([r, c]) => (g.board[at(r, c)] = v));
const eventsOf = <T extends MergeEvent['type']>(g: MergeGame, type: T) => g.events.filter((e): e is Extract<MergeEvent, { type: T }> => e.type === type);
const row3 = (r: number, c0 = 1): Array<[number, number]> => [0, 1, 2].map((k) => [r, c0 + k] as [number, number]);

describe('묶음 찾기', () => {
  it('같은 색·같은 단계가 상하좌우로 이어진 칸만 한 묶음이다', () => {
    const g = blank();
    put(g, [[1, 1], [1, 2], [2, 2]], code(1, 1));
    put(g, [[3, 3]], code(1, 1)); // 대각선이라 이어지지 않는다
    put(g, [[2, 1]], code(2, 1)); // 같은 색이어도 단계가 다르다
    put(g, [[0, 2]], code(1, 2)); // 단계는 같아도 색이 다르다
    expect(groupAt(g.board, 1, 1)).toEqual([at(1, 1), at(1, 2), at(2, 2)]);
    expect(groupAt(g.board, 2, 2)).toEqual([at(1, 1), at(1, 2), at(2, 2)]);
    expect(groupAt(g.board, 3, 3)).toEqual([at(3, 3)]);
    expect(groupAt(g.board, 2, 1)).toEqual([at(2, 1)]);
  });

  it('빈 칸·야유꾼·판 밖은 묶음이 없다', () => {
    const g = blank();
    g.board[at(1, 1)] = HECKLER;
    g.board[at(2, 2)] = 0;
    expect(groupAt(g.board, 1, 1)).toEqual([]);
    expect(groupAt(g.board, 2, 2)).toEqual([]);
    expect(groupAt(g.board, -1, 0)).toEqual([]);
    expect(groupAt(g.board, 0, SIZE)).toEqual([]);
  });

  it('mergeableCells: minGroup개 이상 묶인 칸만 모은다', () => {
    const g = blank();
    expect(mergeableCells(g.board, 3).size).toBe(0);
    put(g, row3(2), code(1, 1));
    put(g, [[4, 0], [4, 1]], code(2, 1));
    expect([...mergeableCells(g.board, 3)].sort((a, b) => a - b)).toEqual(row3(2).map(([r, c]) => at(r, c)));
    expect(mergeableCells(g.board, 2).size).toBe(5);
  });

  it('단계·색 코드 읽기', () => {
    expect(levelOf(code(3, 2))).toBe(3);
    expect(colorOf(code(3, 2))).toBe(2);
  });
});

describe('판 만들기', () => {
  it('처음부터 25칸이 가득 차 있고 합칠 수 있는 묶음이 하나는 있다', () => {
    for (const persona of ['normal', 'dark'] as const)
      for (let seed = 1; seed <= 80; seed++) {
        const g = new MergeGame(persona, seed * 977);
        expect(g.board.every((v) => v !== 0)).toBe(true);
        expect(g.mergeable.size).toBeGreaterThan(0);
        expect(g.events).toEqual([]);
        expect(g.remainingMs).toBe(M.waves[0].ms);
        if (persona === 'normal') expect(g.board.some((v) => v === HECKLER)).toBe(false);
        else expect(Array.from(g.board).filter((v) => v === HECKLER).length).toBeLessThanOrEqual(M.persona.dark.heckleMax);
      }
  });

  it('처음 응원봉은 1단계뿐이다', () => {
    const g = new MergeGame('normal', 5);
    expect(Array.from(g.board).every((v) => levelOf(v) === 1 && colorOf(v) >= 1 && colorOf(v) <= M.colors)).toBe(true);
  });
});

describe('합치기와 응원 파워', () => {
  it('세 개를 합치면 탭한 칸에 한 단계 높은 응원봉이 생기고 나머지는 새 1단계로 채워진다', () => {
    const g = blank();
    put(g, row3(2), code(1, 1));
    const r = g.tap(2, 2);
    expect(r.ok && r.gained).toBeCloseTo(M.power[2], 9);
    expect(g.board[at(2, 2)]).toBe(code(2, 1));
    for (const c of [1, 3]) expect(levelOf(g.board[at(2, c)])).toBe(1);
    expect(g.board.every((v) => v !== 0)).toBe(true);
    expect(g.wavePower[0]).toBeCloseTo(M.power[2], 9);
    expect(g.merges).toBe(1);
    expect(g.combo).toBe(1);
    expect(g.topLevel).toBe(2);
    const e = eventsOf(g, 'merge');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ target: at(2, 2), level: 2, size: 3, chain: 0, combo: 1 });
    expect(e[0].cells).toEqual(row3(2).map(([rr, cc]) => at(rr, cc)));
  });

  it('묶음이 클수록 파워가 크고(크기 ÷ 3), 4개도 한 단계만 오른다', () => {
    const g = blank();
    put(g, [[2, 1], [2, 2], [2, 3], [3, 2]], code(1, 1));
    const r = g.tap(2, 2);
    expect(r.ok && r.gained).toBeCloseTo((M.power[2] * 4) / 3, 9);
    expect(g.board[at(2, 2)]).toBe(code(2, 1));
  });

  it('jumpGroup개 이상이면 두 단계를 뛰어오른다', () => {
    const g = blank();
    put(g, [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]], code(1, 1));
    const r = g.tap(2, 2);
    expect(r.ok && r.gained).toBeCloseTo((M.power[3] * 5) / 3, 9);
    expect(g.board[at(2, 2)]).toBe(code(3, 1));
    expect(g.topLevel).toBe(3);
  });

  it('4단계를 합치면 별 응원봉이 되어 터지고 그 칸은 새로 채워진다', () => {
    const g = blank();
    put(g, row3(2), code(4, 1));
    const r = g.tap(2, 2);
    expect(r.ok && r.gained).toBeCloseTo(M.power[5], 9);
    expect(g.stars).toBe(1);
    expect(g.topLevel).toBe(5);
    expect(levelOf(g.board[at(2, 2)])).toBe(1); // 새로 채워진 1단계
    // 3단계 5개는 두 단계를 뛰어 별 단계다
    const h = blank();
    put(h, [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]], code(3, 1));
    const r2 = h.tap(2, 2);
    expect(r2.ok && r2.gained).toBeCloseTo((M.power[5] * 5) / 3, 9);
    expect(h.stars).toBe(1);
  });

  it('합칠 수 없는 곳을 탭하면 아무것도 바뀌지 않고 콤보만 끊긴다', () => {
    const g = blank();
    put(g, row3(2), code(1, 1));
    g.tap(2, 2);
    expect(g.combo).toBe(1);
    const before = Array.from(g.board);
    const power = g.wavePower[0];
    const small = g.tap(0, 0);
    expect(small).toEqual({ ok: false, reason: 'small' });
    expect(Array.from(g.board)).toEqual(before);
    expect(g.wavePower[0]).toBe(power);
    expect(g.combo).toBe(0);
    expect(eventsOf(g, 'miss')).toEqual([{ type: 'miss', cell: at(0, 0) }]);
  });

  it('빈 칸·야유꾼·판 밖은 무효이고 콤보도 건드리지 않는다', () => {
    const g = blank();
    put(g, row3(3), code(1, 1));
    g.tap(3, 2);
    g.board[at(1, 1)] = HECKLER;
    g.board[at(0, 4)] = 0; // 합친 뒤에는 빈 칸이 바로 채워지므로 나중에 비운다
    expect(g.tap(1, 1)).toEqual({ ok: false, reason: 'invalid' });
    expect(g.tap(0, 4)).toEqual({ ok: false, reason: 'invalid' });
    expect(g.tap(-1, 0)).toEqual({ ok: false, reason: 'invalid' });
    expect(g.tap(0, SIZE)).toEqual({ ok: false, reason: 'invalid' });
    expect(g.combo).toBe(1);
  });

  it('콤보: comboMs 안에 이어서 합치면 배율이 오르고, 오래 쉬면 1부터 다시', () => {
    const g = blank();
    put(g, row3(0), code(1, 1));
    put(g, row3(4), code(1, 1));
    put(g, row3(2), code(1, 1));
    const first = g.tap(0, 2);
    g.advance(M.comboMs - 100);
    const second = g.tap(4, 2);
    expect(first.ok && first.gained).toBeCloseTo(M.power[2], 9);
    expect(second.ok && second.combo).toBe(2);
    expect(second.ok && second.gained).toBeCloseTo(M.power[2] * (1 + M.comboStep), 9);
    expect(g.bestCombo).toBe(2);
    g.advance(M.comboMs + 1);
    const third = g.tap(2, 2);
    expect(third.ok && third.combo).toBe(1);
    expect(third.ok && third.gained).toBeCloseTo(M.power[2], 9);
    expect(g.bestCombo).toBe(2);
  });

  it('콤보 배율은 comboMax에서 멈춘다', () => {
    const g = blank();
    Object.assign(g, { combo: 40, lastMergeAt: 0 }); // 방금 합쳐서 콤보가 이어지는 중
    put(g, row3(2), code(1, 1));
    const r = g.tap(2, 2);
    expect(r.ok && r.gained).toBeCloseTo(M.power[2] * (1 + M.comboStep * M.comboMax), 9);
  });

  it('연쇄: 합쳐서 생긴 응원봉이 같은 단계와 붙으면 저절로 이어서 합쳐진다', () => {
    const g = blank();
    put(g, row3(2), code(1, 1));
    put(g, [[1, 2], [3, 2]], code(2, 1)); // 합치면 생길 2단계와 위아래로 붙는다
    const r = g.tap(2, 2);
    expect(r.ok && r.chain).toBe(1);
    expect(r.ok && r.gained).toBeCloseTo(M.power[2] + M.power[3] * (1 + M.chainStep), 9);
    expect(g.board[at(2, 2)]).toBe(code(3, 1));
    expect(g.bestChain).toBe(1);
    expect(eventsOf(g, 'merge').map((e) => [e.level, e.chain])).toEqual([
      [2, 0],
      [3, 1],
    ]);
    expect(g.merges).toBe(2);
  });

  it('연쇄는 이어질 수 있는 만큼 계속된다', () => {
    const g = blank();
    put(g, row3(2), code(1, 1)); // (2,1)을 눌러 합친다
    put(g, [[1, 1], [0, 1]], code(2, 1)); // 2단계가 되면 위의 2단계 둘과 이어진다
    put(g, [[3, 1], [4, 1]], code(3, 1)); // 3단계가 되면 아래의 3단계 둘과 또 이어진다
    const r = g.tap(2, 1);
    expect(r.ok && r.chain).toBe(2);
    expect(g.board[at(2, 1)]).toBe(code(4, 1));
    expect(r.ok && r.gained).toBeCloseTo(M.power[2] + M.power[3] * (1 + M.chainStep) + M.power[4] * (1 + M.chainStep * 2), 9);
  });

  it('앰프·체인 증폭기·작은 합창 이펙터가 파워에 반영된다', () => {
    const amp = blank();
    amp.effects.amp = 2;
    put(amp, row3(2), code(1, 1));
    const a = amp.tap(2, 2);
    expect(a.ok && a.gained).toBeCloseTo(M.power[2] * (1 + M.effects.ampStep * 2), 9);

    const chain = blank();
    chain.effects.chain = 1;
    put(chain, row3(2), code(1, 1));
    put(chain, [[1, 2], [3, 2]], code(2, 1));
    const c = chain.tap(2, 2);
    expect(c.ok && c.gained).toBeCloseTo(M.power[2] + M.power[3] * (1 + (M.chainStep + M.effects.chainBoost)), 9);

    const pair = blank();
    pair.effects.pair = 1;
    expect(pair.minGroup).toBe(M.effects.pairMin);
    put(pair, [[2, 1], [2, 2]], code(1, 1));
    const p = pair.tap(2, 1);
    expect(p.ok && p.gained).toBeCloseTo((M.power[2] * 2 * M.effects.pairPower) / 3, 9);
    expect(pair.board[at(2, 1)]).toBe(code(2, 1));
    // 작은 합창이 없으면 두 개는 합칠 수 없다
    const none = blank();
    put(none, [[2, 1], [2, 2]], code(1, 1));
    expect(none.tap(2, 1)).toEqual({ ok: false, reason: 'small' });
  });

  it('코러스: 새로 채워지는 응원봉이 확률적으로 2단계로 나온다', () => {
    let upgraded = 0;
    let total = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const g = blank(seed);
      g.effects.chorus = 3; // 75%
      put(g, row3(2), code(1, 1));
      g.tap(2, 2);
      for (const c of [1, 3]) {
        total++;
        if (levelOf(g.board[at(2, c)]) === 2) upgraded++;
      }
    }
    expect(upgraded / total).toBeGreaterThan(0.6);
    expect(upgraded / total).toBeLessThan(0.9);
  });
});

describe('야유꾼(어둠)', () => {
  it('합친 묶음에 붙은 야유꾼은 사라지고 보너스를 준다', () => {
    const g = blank();
    g.board[at(1, 1)] = HECKLER;
    g.board[at(3, 4)] = HECKLER; // 멀리 있는 야유꾼은 그대로
    put(g, row3(2), code(1, 1));
    const r = g.tap(2, 2);
    const drain = 1 - M.heckleDrain * 2;
    expect(r.ok && r.gained).toBeCloseTo(M.power[2] * drain + M.heckleBonus, 9);
    expect(g.heckled).toBe(1);
    expect(g.board[at(3, 4)]).toBe(HECKLER);
    expect(g.board[at(1, 1)]).not.toBe(HECKLER);
    expect(eventsOf(g, 'heckle')).toEqual([{ type: 'heckle', cells: [at(1, 1)] }]);
  });

  it('판 위의 야유꾼 수만큼 합치기 파워가 줄고 0 아래로는 내려가지 않는다', () => {
    const g = blank();
    for (const [r, c] of [[0, 0], [0, 4], [4, 0]] as Array<[number, number]>) g.board[at(r, c)] = HECKLER;
    put(g, row3(2), code(1, 1));
    const r = g.tap(2, 2);
    expect(r.ok && r.gained).toBeCloseTo(M.power[2] * (1 - M.heckleDrain * 3), 9);
  });

  it('어둠은 채울 때 야유꾼이 섞이되 heckleMax를 넘지 않는다', () => {
    let seen = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = new MergeGame('dark', seed);
      g.waveIdx = 3; // 확률이 가장 높은 곡
      for (let k = 0; k < 20; k++) {
        const cells = [...g.mergeable];
        if (cells.length === 0) break;
        g.tap(Math.floor(cells[0] / SIZE), cells[0] % SIZE);
        const n = Array.from(g.board).filter((v) => v === HECKLER).length;
        expect(n).toBeLessThanOrEqual(M.persona.dark.heckleMax);
        seen = Math.max(seen, n);
      }
    }
    expect(seen).toBeGreaterThan(0);
    // 일반은 야유꾼이 절대 나오지 않는다
    for (let seed = 1; seed <= 30; seed++) {
      const g = new MergeGame('normal', seed);
      for (let k = 0; k < 20; k++) {
        const cells = [...g.mergeable];
        if (cells.length === 0) break;
        g.tap(Math.floor(cells[0] / SIZE), cells[0] % SIZE);
        expect(g.board.some((v) => v === HECKLER)).toBe(false);
      }
    }
  });
});

describe('곡 진행과 이펙터 고르기', () => {
  const seedWithOffer = (id: EffectId): number => {
    for (let seed = 1; seed < 500; seed++) {
      const g = new MergeGame('normal', seed);
      g.advance(g.remainingMs);
      if (g.offers.includes(id)) return seed;
    }
    throw new Error(`no seed offers ${id}`);
  };

  it('곡이 끝나면 시간이 멈추고 서로 다른 이펙터 3개를 보여 준다', () => {
    const g = new MergeGame('normal', 3);
    g.advance(M.waves[0].ms - 1);
    expect(g.status).toBe('running');
    g.advance(1);
    expect(g.status).toBe('picking');
    expect(g.picking).toBe(true);
    expect(g.offers).toHaveLength(M.offers);
    expect(new Set(g.offers).size).toBe(M.offers);
    for (const id of g.offers) expect(EFFECT_IDS).toContain(id);
    expect(eventsOf(g, 'waveEnd')).toHaveLength(1);
    expect(eventsOf(g, 'pick')[0].offers).toEqual(g.offers);
    // 고르는 동안 시간은 가지 않고 탭도 안 된다
    const elapsed = g.elapsedMs;
    g.advance(5000);
    expect(g.elapsedMs).toBe(elapsed);
    expect(g.tap(0, 0)).toEqual({ ok: false, reason: 'over' });
  });

  it('하나를 고르면 효과가 쌓이고 다음 곡이 시작된다', () => {
    const g = new MergeGame('normal', 3);
    g.advance(g.remainingMs);
    const id = g.offers[1];
    expect(g.pick(1)).toBe(true);
    expect(g.effects[id]).toBe(1);
    expect(g.status).toBe('running');
    expect(g.waveIdx).toBe(1);
    expect(g.offers).toEqual([]);
    expect(g.remainingMs).toBe(g.waveMs(1));
    expect(eventsOf(g, 'wave').map((e) => e.index)).toEqual([1]);
    // 이미 골랐거나 고르는 중이 아니면 못 고른다
    expect(g.pick(0)).toBe(false);
  });

  it('범위 밖 번호는 고를 수 없다', () => {
    const g = new MergeGame('normal', 3);
    g.advance(g.remainingMs);
    expect(g.pick(5)).toBe(false);
    expect(g.pick(-1)).toBe(false);
    expect(g.status).toBe('picking');
  });

  it('조명은 이후 곡 시간을 늘린다', () => {
    const g = new MergeGame('normal', seedWithOffer('light'));
    g.advance(g.remainingMs);
    g.pick(g.offers.indexOf('light'));
    expect(g.remainingMs).toBe(M.waves[1].ms + M.effects.lightMs);
    expect(g.waveMs(2)).toBe(M.waves[2].ms + M.effects.lightMs);
    expect(g.waveMs(0)).toBe(M.waves[0].ms + M.effects.lightMs); // 계산식만 보면 모든 곡에 붙지만 이미 지난 곡엔 쓰이지 않는다
  });

  it('한도에 찬 이펙터는 다시 나오지 않는다', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = new MergeGame('normal', seed);
      g.effects.pair = M.effectMax.pair;
      g.effects.amp = M.effectMax.amp;
      g.advance(g.remainingMs);
      expect(g.offers).not.toContain('pair');
      expect(g.offers).not.toContain('amp');
      expect(g.offers).toHaveLength(M.offers);
    }
    const all = new MergeGame('normal', 1);
    for (const id of EFFECT_IDS) all.effects[id] = M.effectMax[id];
    all.advance(all.remainingMs);
    expect(all.status).toBe('running'); // 고를 게 없으면 바로 다음 곡
    expect(all.waveIdx).toBe(1);
  });

  it('앙코르(마지막 곡)가 끝나면 이펙터 없이 공연이 끝난다', () => {
    const g = new MergeGame('normal', 7);
    for (let i = 0; i < M.waves.length - 1; i++) {
      g.advance(g.remainingMs);
      expect(g.picking).toBe(true);
      g.pick(0);
    }
    expect(g.waveIdx).toBe(M.waves.length - 1);
    g.advance(g.remainingMs);
    expect(g.over).toBe(true);
    expect(eventsOf(g, 'end')).toHaveLength(1);
    expect(g.offers).toEqual([]);
    expect(g.tap(0, 0)).toEqual({ ok: false, reason: 'over' });
    g.advance(1000);
    expect(g.pick(0)).toBe(false);
  });

  it('시간이 음수이거나 NaN이어도 진행하지 않는다', () => {
    const g = new MergeGame('normal', 2);
    g.advance(-100);
    g.advance(Number.NaN);
    expect(g.elapsedMs).toBe(0);
    expect(g.remainingMs).toBe(M.waves[0].ms);
  });

  it('곡이 시작될 때 합칠 수 있는 묶음이 없으면 만들어 준다', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = blank(seed);
      expect(g.mergeable.size).toBe(0);
      g.advance(g.remainingMs);
      g.pick(0);
      expect(g.mergeable.size).toBeGreaterThan(0);
    }
    // 1단계가 하나도 없어 색을 섞을 수 없어도 이어진 세 칸을 1단계로 바꿔서 한 수는 남긴다
    const g = blank(3);
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) g.board[at(r, c)] = code(2, ((r + 2 * c) % 3) + 1);
    expect(g.mergeable.size).toBe(0);
    g.advance(g.remainingMs);
    g.pick(0);
    expect(g.mergeable.size).toBeGreaterThanOrEqual(3);
    expect(eventsOf(g, 'reshuffle').length).toBeGreaterThan(0);
  });

  it('합치고 난 뒤에도 항상 한 수는 남아 있다', () => {
    for (const persona of ['normal', 'dark'] as const)
      for (let seed = 1; seed <= 25; seed++) {
        const g = new MergeGame(persona, seed * 31);
        for (let k = 0; k < 60 && !g.over; k++) {
          if (g.picking) {
            g.pick(0);
            continue;
          }
          const cells = [...g.mergeable];
          expect(cells.length).toBeGreaterThan(0);
          const cell = cells[(k * 7) % cells.length];
          g.tap(Math.floor(cell / SIZE), cell % SIZE);
          expect(g.board.every((v) => v !== 0)).toBe(true);
          g.advance(900);
        }
      }
  });
});

describe('열기 점수와 클리어', () => {
  it('곡마다 목표를 채운 만큼(상한 1) waveScore점을 받아 합친다', () => {
    const g = new MergeGame('normal', 1);
    const goals = M.persona.normal.goals;
    expect(g.score).toBe(0);
    g.wavePower[0] = goals[0] / 2;
    expect(g.score).toBe(Math.round(M.waveScore / 2));
    g.wavePower[0] = goals[0] * 5; // 넘친 파워는 점수가 되지 않는다
    expect(g.score).toBe(M.waveScore);
    g.wavePower = goals.map((x) => x * 10);
    expect(g.score).toBe(1000);
  });

  it('열기 점수 600 이상이 클리어', () => {
    const g = new MergeGame('normal', 1);
    g.wavePower = M.persona.normal.goals.map((x) => x * 0.6);
    expect(g.score).toBe(600);
    expect(g.cleared).toBe(true);
    g.wavePower = M.persona.normal.goals.map((x) => x * 0.59);
    expect(g.cleared).toBe(false);
    const d = new MergeGame('dark', 1);
    d.wavePower = M.persona.dark.goals.map((x) => x * 0.6);
    expect(d.cleared).toBe(true);
  });

  it('어둠은 목표가 곡마다 더 높다', () => {
    expect(M.persona.dark.goals).toHaveLength(M.waves.length);
    expect(M.persona.normal.goals).toHaveLength(M.waves.length);
    M.persona.dark.goals.forEach((goal, i) => expect(goal).toBeGreaterThan(M.persona.normal.goals[i]));
    expect(M.persona.dark.heckleChance).toHaveLength(M.waves.length);
  });

  it('요약: 합친 횟수·연쇄·콤보·곡별 달성률·이펙터', () => {
    const g = blank();
    put(g, row3(2), code(1, 1));
    put(g, [[1, 2], [3, 2]], code(2, 1));
    g.tap(2, 2);
    g.effects.amp = 2;
    const s = g.summary;
    expect(s).toMatchObject({ merges: 2, bestChain: 1, bestCombo: 1, topLevel: 3, stars: 0, heckled: 0, seconds: 0 });
    expect(s.waves).toHaveLength(M.waves.length);
    expect(s.waves[0]).toBe(Math.round(g.waveRatio(0) * 100));
    expect(s.effects.amp).toBe(2);
    s.effects.amp = 99; // 요약은 복사본이다
    expect(g.effects.amp).toBe(2);
  });
});

describe('결정성', () => {
  const play = (seed: number, persona: 'normal' | 'dark') => {
    const g = new MergeGame(persona, seed);
    for (let k = 0; k < 120 && !g.over; k++) {
      if (g.picking) {
        g.pick(k % g.offers.length);
        continue;
      }
      const cells = [...g.mergeable];
      if (cells.length > 0) {
        const cell = cells[(k * 5) % cells.length];
        g.tap(Math.floor(cell / SIZE), cell % SIZE);
      }
      g.advance(700);
    }
    return { board: Array.from(g.board), power: g.wavePower, effects: g.effects, merges: g.merges, status: g.status };
  };

  it('같은 씨앗·같은 입력이면 같은 판이다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      expect(play(123, persona)).toEqual(play(123, persona));
      expect(play(123, persona)).not.toEqual(play(124, persona));
    }
    expect(play(123, 'normal').merges).toBeGreaterThan(10);
  });
});

describe('단콘 직접 공연 연결', () => {
  const ready = () => {
    const s = createInitialState(T0);
    const cleared = { cleared: true, bestScore: 0, cooldownUntil: 0 };
    return { ...s, fans: 100_000, concerts: { ...s.concerts, room: cleared, club: cleared, hall: cleared } };
  };

  it('단콘은 응원봉 머지 웨이브이고 다른 공연장은 각자 자기 게임이다', () => {
    expect(manualGameOf('solo')).toBe('merge');
    expect(manualGameOf('hall')).toBe('blocks');
    expect(manualGameOf('club')).toBe('run');
    expect(manualGameOf('room')).toBe('timing');
    expect(manualGameOf('medium')).toBe('bounce');
    expect(manualGameOf('large')).toBe('defense');
    expect(manualGameOf('arena')).toBe('survivor');
    expect(manualGameOf('world')).toBe('prestige');
    expect(manualGameOf('ruins')).toBe('swipe');
  });

  it('직접 공연을 시작하면 머지 웨이브로 쿨다운이 확정된다', () => {
    const solo = beginManualConcert(ready(), 'solo', 's1');
    if (!solo.ok) throw new Error('begin failed');
    expect(solo.run.game).toBe('merge');
    expect(solo.state.concerts.solo.cooldownUntil).toBe(T0 + BALANCE.concert.cooldownMs);
    expect(beginManualConcert(solo.state, 'solo', 's2').ok).toBe(false);
  });

  it('보상: 어둠은 2배, 클리어하지 못하면 절반', () => {
    expect(manualConcertReward(300, 1000, 'normal', 'merge', true)).toBe(600);
    expect(manualConcertReward(300, 1000, 'dark', 'merge', true)).toBe(1200);
    expect(manualConcertReward(300, 1000, 'normal', 'merge', false)).toBe(300);
  });

  it('클리어는 열기 점수 600으로 정한다', () => {
    const begin = beginManualConcert(ready(), 'solo', 's3');
    if (!begin.ok) throw new Error('begin failed');
    const won = finishManualConcert(begin.state, begin.run, 600);
    expect(won.ok && won.outcome.cleared).toBe(true);
    expect(won.ok && won.outcome.firstClear).toBe(true);
    expect(won.ok && won.state.concerts.solo.cleared).toBe(true);
    expect(won.ok && won.outcome.coins).toBe(manualConcertReward(300, 600, 'normal', 'merge') + 3000);

    const begin2 = beginManualConcert(ready(), 'solo', 's4');
    if (!begin2.ok) throw new Error('begin failed');
    const lost = finishManualConcert(begin2.state, begin2.run, 599);
    expect(lost.ok && lost.outcome.cleared).toBe(false);
    expect(lost.ok && lost.state.concerts.solo.cleared).toBe(false);
    expect(lost.ok && lost.outcome.firstClearCoins).toBe(0);
  });
});

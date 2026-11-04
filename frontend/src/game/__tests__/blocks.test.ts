import { describe, expect, it } from 'vitest';
import { BALANCE, manualGameOf } from '../balance';
import { BROKEN, BlocksGame, PIECES, SET_STARTS, SIZE, TOTAL_MS, fits, fitsAnywhere, previewClears, setIndexAt, type BlockEvent, type Piece } from '../blocks';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { createInitialState } from '../persistence';
import { stageStatus } from '../selectors';

const B = BALANCE.blocks;
const T0 = 1_700_000_000_000;

const DOT = PIECES[0];
const piece = (art: string): Piece => {
  const found = PIECES.find((p) => p.cells.map(([r, c]) => `${r},${c}`).join(';') === art);
  if (!found) throw new Error(`no piece ${art}`);
  return found;
};
const BAR3 = piece('0,0;0,1;0,2');
const SQ3 = piece('0,0;0,1;0,2;1,0;1,1;1,2;2,0;2,1;2,2');

const countOf = (g: BlocksGame, v: number) => Array.from(g.board).filter((x) => x === v).length;
const at = (r: number, c: number) => r * SIZE + c;
/** 가로줄 한 줄을 (skip 열만 빼고) 채운다 */
const fillRow = (g: BlocksGame, r: number, skip: number | null = null, v = 1) => {
  for (let c = 0; c < SIZE; c++) if (c !== skip) g.board[at(r, c)] = v;
};
const fillCol = (g: BlocksGame, c: number, skip: number | null = null, v = 1) => {
  for (let r = 0; r < SIZE; r++) if (r !== skip) g.board[at(r, c)] = v;
};
/** 불량 칸 없이 깨끗한 일반 판. 줄이 터져도 바닥이 통째로 비지 않게 한 칸(5행 2열)에 블록을 하나 둔다(anchor=false면 비운다). */
function fresh(seed = 1, anchor = true): BlocksGame {
  const g = new BlocksGame('normal', seed);
  g.board.fill(0);
  if (anchor) g.board[at(5, 2)] = 2;
  g.events.length = 0;
  return g;
}
const eventsOf = <T extends BlockEvent['type']>(g: BlocksGame, type: T) => g.events.filter((e): e is Extract<BlockEvent, { type: T }> => e.type === type);

describe('블록 목록', () => {
  it('모든 블록의 칸이 자기 크기 안에 있고 모양이 겹치지 않는다', () => {
    const seen = new Set<string>();
    for (const p of PIECES) {
      expect(p.cells.length).toBeGreaterThan(0);
      for (const [r, c] of p.cells) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(p.h);
        expect(c).toBeLessThan(p.w);
      }
      expect(Math.max(...p.cells.map(([, c]) => c)) + 1).toBe(p.w);
      expect(Math.max(...p.cells.map(([r]) => r)) + 1).toBe(p.h);
      expect(p.color).toBeGreaterThanOrEqual(1);
      expect(p.color).toBeLessThanOrEqual(5);
      const key = p.cells.map(([r, c]) => `${r},${c}`).join(';');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(PIECES.map((p) => p.id)).toEqual(PIECES.map((_, i) => i));
    for (const t of [0, 1, 2]) expect(PIECES.some((p) => p.tier === t)).toBe(true);
  });

  it('fits: 바닥 안이고 빈 칸이어야 한다', () => {
    const g = fresh();
    expect(fits(g.board, SQ3, 0, 0)).toBe(true);
    expect(fits(g.board, SQ3, SIZE - 3, SIZE - 3)).toBe(true);
    expect(fits(g.board, SQ3, SIZE - 2, 0)).toBe(false);
    expect(fits(g.board, SQ3, 0, SIZE - 2)).toBe(false);
    expect(fits(g.board, SQ3, -1, 0)).toBe(false);
    g.board[at(1, 1)] = 2;
    expect(fits(g.board, SQ3, 0, 0)).toBe(false);
    expect(fits(g.board, BAR3, 1, 0)).toBe(false);
    expect(fits(g.board, BAR3, 1, 2)).toBe(true);
    g.board[at(3, 3)] = BROKEN;
    expect(fits(g.board, DOT, 3, 3)).toBe(false);
    expect(fitsAnywhere(g.board, SQ3)).toBe(true);
    g.board.fill(1);
    expect(fitsAnywhere(g.board, DOT)).toBe(false);
  });

  it('previewClears: 놓으면 터질 줄만 알려 주고 바닥은 바꾸지 않는다', () => {
    const g = fresh();
    fillRow(g, 2, 5);
    fillCol(g, 5, 2);
    const before = Array.from(g.board);
    expect(previewClears(g.board, DOT, 2, 5)).toEqual({ rows: [2], cols: [5] });
    expect(previewClears(g.board, DOT, 0, 0)).toEqual({ rows: [], cols: [] });
    expect(previewClears(g.board, DOT, 2, 4)).toEqual({ rows: [], cols: [] }); // 놓을 수 없는 자리
    expect(Array.from(g.board)).toEqual(before);
  });
});

describe('놓기와 점수', () => {
  it('블록을 놓으면 칸이 채워지고 손에서 빠지며 칸 수만큼 점수를 받는다', () => {
    const g = fresh();
    g.hand = [BAR3, DOT, SQ3];
    const r = g.place(0, 4, 2);
    expect(r.ok && r.gained).toBe(3 * B.placePoint);
    expect([2, 3, 4].map((c) => g.board[at(4, c)])).toEqual([BAR3.color, BAR3.color, BAR3.color]);
    expect(g.hand[0]).toBeNull();
    expect(g.pieces).toBe(1);
    expect(g.points).toBe(3);
    expect(g.combo).toBe(0);
  });

  it('겹치거나 바닥 밖이면 놓지 못하고 아무것도 바뀌지 않는다', () => {
    const g = fresh();
    g.hand = [BAR3, null, DOT];
    g.board[at(0, 1)] = 3;
    expect(g.place(0, 0, 0)).toEqual({ ok: false, reason: 'blocked' });
    expect(g.place(0, 0, SIZE - 2)).toEqual({ ok: false, reason: 'blocked' });
    expect(g.place(1, 5, 5)).toEqual({ ok: false, reason: 'empty' });
    expect(g.hand[0]).toBe(BAR3);
    expect(g.points).toBe(0);
    expect(g.pieces).toBe(0);
  });

  it('줄 하나를 터뜨리면 줄이 사라지고 clearPoint를 더 받는다', () => {
    const g = fresh();
    fillRow(g, 0, 7);
    g.hand = [DOT, BAR3, BAR3];
    const r = g.place(0, 0, 7);
    expect(r.ok && r.rows).toEqual([0]);
    expect(r.ok && r.gained).toBe(B.placePoint + B.clearPoint);
    for (let c = 0; c < SIZE; c++) expect(g.board[at(0, c)]).toBe(0);
    expect(g.lines).toBe(1);
    expect(g.combo).toBe(1);
    expect(eventsOf(g, 'clear')).toHaveLength(1);
  });

  it('가로·세로를 한꺼번에 터뜨리면 n(n+1)/2배를 받는다', () => {
    const g = fresh();
    fillRow(g, 0, 7);
    fillCol(g, 7, 0);
    g.hand = [DOT, BAR3, BAR3];
    const r = g.place(0, 0, 7);
    expect(r.ok && r.rows).toEqual([0]);
    expect(r.ok && r.cols).toEqual([7]);
    expect(r.ok && r.gained).toBe(B.placePoint + B.clearPoint * 3);
    expect(g.lines).toBe(2);
    expect(countOf(g, 1)).toBe(0);
  });

  it('줄을 터뜨리지 않아도 줄을 못 채우면 그대로 남는다', () => {
    const g = fresh();
    fillRow(g, 0, 6);
    g.hand = [BAR3, DOT, DOT];
    const r = g.place(1, 1, 1);
    expect(r.ok && r.rows).toEqual([]);
    expect(g.lines).toBe(0);
    expect(g.board[at(0, 0)]).toBe(1);
  });

  it('콤보: 이어서 터뜨릴수록 배율이 comboStep씩 오르고 comboMax에서 멈춘다', () => {
    const g = fresh();
    g.hand = [DOT, DOT, DOT];
    const gains: number[] = [];
    for (let i = 0; i < 3; i++) {
      fillRow(g, i, 7);
      const r = g.place(i, i, 7);
      gains.push(r.ok ? r.gained : -1);
    }
    expect(gains[0]).toBeCloseTo(1 + 10 * 1, 9);
    expect(gains[1]).toBeCloseTo(1 + 10 * (1 + B.comboStep), 9);
    expect(gains[2]).toBeCloseTo(1 + 10 * (1 + B.comboStep * 2), 9);
    expect(g.combo).toBe(3);
    expect(g.bestCombo).toBe(3);

    // 배율 한도
    const h = fresh();
    h.combo = 50;
    fillRow(h, 0, 7);
    h.hand = [DOT, DOT, DOT];
    const r = h.place(0, 0, 7);
    expect(r.ok && r.gained).toBeCloseTo(1 + 10 * (1 + B.comboStep * B.comboMax), 9);
  });

  it('콤보: 못 터뜨린 수가 comboGrace번을 넘으면 끊긴다', () => {
    const g = fresh();
    fillRow(g, 0, 7);
    g.hand = [DOT, DOT, DOT];
    g.place(0, 0, 7);
    expect(g.combo).toBe(1);
    // 터뜨리지 못하는 수를 comboGrace번까지는 버틴다
    for (let i = 0; i < B.comboGrace; i++) {
      g.hand = [DOT, DOT, DOT];
      g.place(0, 5, i);
      expect(g.combo).toBe(1);
    }
    g.hand = [DOT, DOT, DOT];
    g.place(0, 6, 0);
    expect(g.combo).toBe(0);
    // 끊긴 뒤에 다시 터뜨리면 1부터 시작한다
    fillRow(g, 1, 7);
    g.hand = [DOT, DOT, DOT];
    const r = g.place(0, 1, 7);
    expect(g.combo).toBe(1);
    expect(r.ok && r.gained).toBeCloseTo(1 + 10, 9);
    expect(g.bestCombo).toBe(1);
  });

  it('불량 칸도 찬 칸으로 치고, 그 줄이 터지면 같이 사라진다', () => {
    const g = fresh();
    g.board[at(0, 0)] = BROKEN;
    fillRow(g, 0, 7);
    g.board[at(0, 0)] = BROKEN;
    g.hand = [DOT, DOT, DOT];
    const r = g.place(0, 0, 7);
    expect(r.ok && r.rows).toEqual([0]);
    expect(g.board[at(0, 0)]).toBe(0);
    expect(countOf(g, BROKEN)).toBe(0);
  });

  it('바닥이 통째로 비면 퍼펙트 보너스', () => {
    const g = fresh(1, false);
    fillRow(g, 0, 7);
    g.hand = [DOT, DOT, DOT];
    const r = g.place(0, 0, 7);
    expect(r.ok && r.perfect).toBe(true);
    expect(r.ok && r.gained).toBe(B.placePoint + B.clearPoint + B.perfectBonus);
    expect(g.perfects).toBe(1);
    expect(eventsOf(g, 'perfect')).toHaveLength(1);

    const h = fresh();
    fillRow(h, 0, 7);
    h.board[at(5, 5)] = 2;
    h.hand = [DOT, DOT, DOT];
    const r2 = h.place(0, 0, 7);
    expect(r2.ok && r2.perfect).toBe(false);
  });

  it('곡 배율: 뒤 곡일수록 같은 수가 더 값지다', () => {
    const g = fresh();
    g.advance(SET_STARTS[2] + 10);
    g.board.fill(0);
    g.board[at(5, 2)] = 2;
    g.hand = [DOT, DOT, DOT];
    fillRow(g, 0, 7);
    const r = g.place(0, 0, 7);
    expect(g.setMult).toBe(B.sets[2].mult);
    expect(r.ok && r.gained).toBeCloseTo((B.placePoint + B.clearPoint) * B.sets[2].mult, 9);
  });

  it('손의 블록을 다 놓으면 새 블록 3개를 받는다', () => {
    const g = fresh();
    g.hand = [DOT, DOT, DOT];
    g.place(0, 0, 0);
    g.place(1, 0, 1);
    expect(g.hand.filter(Boolean)).toHaveLength(1);
    g.place(2, 0, 2);
    expect(g.hand).toHaveLength(B.hand);
    expect(g.hand.every((p) => p !== null)).toBe(true);
  });
});

describe('열기 점수와 클리어', () => {
  it('열기 점수 = 1000 × 점수 ÷ target(1000이 상한), 600 이상이 클리어', () => {
    const g = fresh();
    const target = B.persona.normal.target;
    g.points = target * 0.6;
    expect(g.score).toBe(600);
    expect(g.cleared).toBe(true);
    g.points = target * 0.6 - 1;
    expect(g.score).toBeLessThan(600);
    expect(g.cleared).toBe(false);
    g.points = target * 5;
    expect(g.score).toBe(1000);
    g.points = 0;
    expect(g.score).toBe(0);
    expect(g.cleared).toBe(false);

    const d = new BlocksGame('dark', 1);
    d.points = B.persona.dark.target * 0.6;
    expect(d.score).toBe(600);
    expect(d.cleared).toBe(true);
    expect(B.persona.dark.target).toBeGreaterThan(B.persona.normal.target);
  });
});

describe('곡 진행과 불량 칸', () => {
  it('곡이 바뀔 때마다 불량 칸이 brokenPerSet만큼 생긴다', () => {
    const g = new BlocksGame('normal', 7);
    expect(countOf(g, BROKEN)).toBe(B.persona.normal.startBroken);
    let expected = B.persona.normal.startBroken;
    for (let i = 1; i < B.sets.length; i++) {
      g.advance(SET_STARTS[i] - g.elapsedMs - 1);
      expect(g.setIndex).toBe(i - 1);
      g.advance(2);
      expected += B.persona.normal.brokenPerSet[i];
      expect(g.setIndex).toBe(i);
      expect(countOf(g, BROKEN)).toBe(expected);
    }
    expect(g.status).toBe('running');
  });

  it('프레임이 크게 건너뛰어도 지나간 곡의 사고가 모두 일어난다', () => {
    const g = new BlocksGame('normal', 7);
    g.advance(TOTAL_MS - 1);
    expect(g.setIndex).toBe(B.sets.length - 1);
    expect(eventsOf(g, 'set').map((e) => e.index)).toEqual([1, 2, 3]);
    expect(countOf(g, BROKEN)).toBe(B.persona.normal.brokenPerSet.reduce<number>((a, n) => a + n, 0));
    expect(g.status).toBe('running');
    g.advance(5);
    expect(g.status).toBe('finished');
    expect(g.stuck).toBe(false);
    expect(g.elapsedMs).toBe(TOTAL_MS);
    expect(eventsOf(g, 'end')).toEqual([{ type: 'end', stuck: false }]);
  });

  it('어둠은 시작할 때부터 불량 칸이 깔려 있다', () => {
    const d = new BlocksGame('dark', 3);
    expect(countOf(d, BROKEN)).toBe(B.persona.dark.startBroken);
    expect(B.persona.dark.startBroken).toBeGreaterThan(B.persona.normal.startBroken);
    expect(d.events).toEqual([]);
  });

  it('곡 시각 표: 곡 번호·남은 시간·진행도', () => {
    expect(SET_STARTS).toHaveLength(B.sets.length);
    expect(SET_STARTS[0]).toBe(0);
    expect(TOTAL_MS).toBe(B.sets.reduce((a, s) => a + s.ms, 0));
    expect(setIndexAt(0)).toBe(0);
    expect(setIndexAt(SET_STARTS[1] - 1)).toBe(0);
    expect(setIndexAt(SET_STARTS[1])).toBe(1);
    expect(setIndexAt(TOTAL_MS)).toBe(B.sets.length - 1);
    const g = fresh();
    expect(g.setRemainingMs).toBe(B.sets[0].ms);
    g.advance(1000);
    expect(g.setRemainingMs).toBe(B.sets[0].ms - 1000);
    expect(g.progress).toBeCloseTo(1000 / TOTAL_MS, 9);
  });

  it('시간이 음수이거나 NaN이어도 진행하지 않고, 끝난 뒤에는 아무것도 하지 않는다', () => {
    const g = fresh();
    g.advance(-500);
    g.advance(Number.NaN);
    expect(g.elapsedMs).toBe(0);
    g.advance(TOTAL_MS * 2);
    expect(g.status).toBe('finished');
    const before = g.points;
    g.advance(1000);
    expect(g.place(0, 0, 0)).toEqual({ ok: false, reason: 'over' });
    expect(g.points).toBe(before);
    expect(g.elapsedMs).toBe(TOTAL_MS);
  });
});

describe('막힘과 구제', () => {
  /** 한 칸씩 건너 채운 바닥: 줄은 안 차고 2칸 이상 블록은 어디에도 안 들어간다 */
  const checker = (g: BlocksGame) => {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) g.board[at(r, c)] = (r + c) % 2 === 0 ? 1 : 0;
  };

  it('놓을 곳이 없으면 스태프가 가장 찬 줄을 치우고 새 블록을 준다', () => {
    const g = fresh(5);
    checker(g);
    g.hand = [DOT, SQ3, SQ3];
    g.place(0, 0, 1); // 한 칸짜리를 놓으면 남은 손(3×3 둘)은 들어갈 곳이 없다
    expect(g.status).toBe('running');
    expect(g.rescuesUsed).toBe(1);
    expect(g.rescuesLeft).toBe(B.persona.normal.rescues - 1);
    const rescue = eventsOf(g, 'rescue');
    expect(rescue).toHaveLength(1);
    expect(g.hand.every((p) => p !== null)).toBe(true);
    // 치운 줄과 칸은 비었고, 새 블록은 하나씩은 들어간다
    for (let c = 0; c < SIZE; c++) expect(g.board[at(rescue[0].row, c)]).toBe(0);
    for (let r = 0; r < SIZE; r++) expect(g.board[at(r, rescue[0].col)]).toBe(0);
    for (const p of g.hand) expect(p && fitsAnywhere(g.board, p)).toBe(true);
  });

  it('구제를 다 쓴 뒤에도 막히면 거기서 끝난다', () => {
    const g = fresh(5);
    g.rescuesLeft = 0;
    checker(g);
    g.hand = [DOT, SQ3, SQ3];
    g.place(0, 0, 1);
    expect(g.status).toBe('finished');
    expect(g.stuck).toBe(true);
    expect(g.summary.stuck).toBe(true);
    expect(eventsOf(g, 'end')).toEqual([{ type: 'end', stuck: true }]);
    expect(g.place(1, 0, 0)).toEqual({ ok: false, reason: 'over' });
  });

  it('곡이 바뀔 때도 놓을 곳이 없으면 막힘으로 처리한다', () => {
    const g = fresh(5);
    g.rescuesLeft = 0;
    checker(g);
    g.hand = [SQ3, SQ3, SQ3];
    g.advance(SET_STARTS[1] + 1);
    expect(g.status).toBe('finished');
    expect(g.stuck).toBe(true);
  });
});

describe('결정성과 공정한 배분', () => {
  it('같은 씨앗·같은 입력이면 같은 판이다', () => {
    const play = (seed: number) => {
      const g = new BlocksGame('dark', seed);
      let guard = 0;
      while (!g.over && guard++ < 400) {
        g.advance(1500);
        if (g.over) break;
        let moved = false;
        for (let i = 0; i < B.hand && !moved; i++) {
          const p = g.hand[i];
          if (!p) continue;
          for (let r = 0; r + p.h <= SIZE && !moved; r++)
            for (let c = 0; c + p.w <= SIZE && !moved; c++)
              if (g.canPlace(i, r, c)) {
                g.place(i, r, c);
                moved = true;
              }
        }
        if (!moved) break;
      }
      return { board: Array.from(g.board), points: g.points, hand: g.hand.map((p) => p?.id ?? -1), pieces: g.pieces, lines: g.lines };
    };
    expect(play(123)).toEqual(play(123));
    expect(play(123)).not.toEqual(play(124));
    expect(play(123).pieces).toBeGreaterThan(5);
  });

  it('새로 받는 블록은 지금 바닥에 하나씩은 들어간다', () => {
    for (const persona of ['normal', 'dark'] as const)
      for (let seed = 1; seed <= 60; seed++) {
        const g = new BlocksGame(persona, seed * 977);
        expect(g.hand).toHaveLength(B.hand);
        for (const p of g.hand) expect(p && fitsAnywhere(g.board, p)).toBe(true);
      }
  });

  it('곡이 뒤로 갈수록 어려운 블록이 더 자주 나오고, 어둠은 같은 곡에서 더 어렵다', () => {
    /** 새로 받은 블록 중 중간 이상(tier 1 이상)과 큰 것(tier 2)의 비율 */
    const share = (persona: 'normal' | 'dark', set: number) => {
      let hard = 0;
      let big = 0;
      let all = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const g = new BlocksGame(persona, seed * 31);
        g.board.fill(0);
        g.setIdx = set;
        g.hand = [DOT, DOT, DOT];
        g.place(0, 0, 0);
        g.place(1, 0, 1);
        g.place(2, 0, 2); // 손을 다 놓아서 곡 set의 가중치로 새로 받는다
        for (const p of g.hand) {
          all++;
          if (p && p.tier >= 1) hard++;
          if (p && p.tier === 2) big++;
        }
      }
      return { hard: hard / all, big: big / all };
    };
    const normal = [0, 1, 2, 3].map((i) => share('normal', i));
    const dark = [0, 1, 2, 3].map((i) => share('dark', i));
    for (let i = 1; i < 4; i++) expect(normal[i].hard).toBeGreaterThan(normal[i - 1].hard);
    for (let i = 0; i < 4; i++) expect(dark[i].hard).toBeGreaterThan(normal[i].hard);
    expect(normal[0].big).toBe(0);
    expect(normal[3].big).toBeGreaterThan(normal[2].big);
    expect(dark[3].big).toBeGreaterThan(normal[3].big);
  });
});

describe('소형 공연장 직접 공연 연결', () => {
  const ready = () => {
    const s = createInitialState(T0);
    return {
      ...s,
      fans: 100_000,
      concerts: { ...s.concerts, room: { cleared: true, bestScore: 0, cooldownUntil: 0 }, club: { cleared: true, bestScore: 0, cooldownUntil: 0 } },
    };
  };

  it('소형 공연장은 무대 세팅 블록이고 다른 공연장은 각자 자기 게임이다', () => {
    expect(manualGameOf('hall')).toBe('blocks');
    expect(manualGameOf('room')).toBe('timing');
    expect(manualGameOf('club')).toBe('run');
    expect(manualGameOf('solo')).toBe('merge');
    expect(manualGameOf('medium')).toBe('bounce');
    expect(manualGameOf('large')).toBe('defense');
    expect(manualGameOf('arena')).toBe('survivor');
    expect(manualGameOf('world')).toBe('prestige');
    expect(manualGameOf('ruins')).toBe('run');
  });

  it('직접 공연을 시작하면 블록 게임으로 쿨다운이 확정된다', () => {
    const hall = beginManualConcert(ready(), 'hall', 'h1');
    if (!hall.ok) throw new Error('begin failed');
    expect(hall.run.game).toBe('blocks');
    expect(hall.state.concerts.hall.cooldownUntil).toBe(T0 + BALANCE.concert.cooldownMs);
    const again = beginManualConcert(hall.state, 'hall', 'h2');
    expect(again.ok).toBe(false);
  });

  it('임시로 열어 둔 동안은 팬·앞 공연장 조건 없이도 입장할 수 있다', () => {
    const s = createInitialState(T0);
    const st = stageStatus(s, 'hall');
    expect(st.fansOk).toBe(true);
    expect(st.previousCleared).toBe(true);
    expect(st.canRun).toBe(true);
    expect(beginManualConcert(s, 'hall', 'h1').ok).toBe(true);
    // 단콘~월클도 같이 열려 있고, 지하 클럽과 월클 뒤의 비밀 공연장은 원래 조건 그대로
    for (const id of ['solo', 'medium', 'large', 'arena', 'world'] as const) expect(stageStatus(s, id).canRun).toBe(true);
    expect(stageStatus(s, 'club').unlocked).toBe(false);
    expect(stageStatus(s, 'rooftop').unlocked).toBe(false);
  });

  it('보상: 어둠은 2배, 클리어하지 못하면 절반', () => {
    expect(manualConcertReward(150, 1000, 'normal', 'blocks', true)).toBe(300);
    expect(manualConcertReward(150, 1000, 'dark', 'blocks', true)).toBe(600);
    expect(manualConcertReward(150, 1000, 'normal', 'blocks', false)).toBe(150);
    expect(manualConcertReward(150, 500, 'normal', 'blocks')).toBe(Math.floor(150 * 1.5 * BALANCE.concert.failRewardRate));
  });

  it('클리어는 열기 점수 600으로 정한다: 600 이상이면 첫 클리어 보너스', () => {
    const begin = beginManualConcert(ready(), 'hall', 'h3');
    if (!begin.ok) throw new Error('begin failed');
    const won = finishManualConcert(begin.state, begin.run, 600);
    expect(won.ok && won.outcome.cleared).toBe(true);
    expect(won.ok && won.outcome.firstClear).toBe(true);
    expect(won.ok && won.state.concerts.hall.cleared).toBe(true);
    expect(won.ok && won.outcome.coins).toBe(manualConcertReward(150, 600, 'normal', 'blocks') + 1200);

    const begin2 = beginManualConcert(ready(), 'hall', 'h4');
    if (!begin2.ok) throw new Error('begin failed');
    const lost = finishManualConcert(begin2.state, begin2.run, 599);
    expect(lost.ok && lost.outcome.cleared).toBe(false);
    expect(lost.ok && lost.state.concerts.hall.cleared).toBe(false);
    expect(lost.ok && lost.outcome.firstClearCoins).toBe(0);
    expect(lost.ok && lost.outcome.coins).toBe(manualConcertReward(150, 599, 'normal', 'blocks'));
  });
});

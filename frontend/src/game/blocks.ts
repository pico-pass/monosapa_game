import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 무대 세팅 블록: 소형 공연장의 직접 공연. 8×8 무대 바닥에 악기 블록을 놓아 줄을 터뜨린다.
 * 규칙은 React·DOM과 무관하고 무작위는 씨앗 난수라서, 같은 씨앗·같은 입력이면 항상 같은 판이 된다.
 * 시간은 곡 전환(불량 칸 생김)과 공연 끝에만 쓰이고 advance(dt)로 넣는다. 수치와 규칙 설명은 balance.ts의 BALANCE.blocks.
 */

const B = BALANCE.blocks;

export const SIZE = B.size;
const CELLS = SIZE * SIZE;
/** 불량 칸 값. 1~5는 블록 색, 0은 빈 칸. */
export const BROKEN = 9;

/** 곡 시작 시각(ms)과 공연 전체 길이 */
export const SET_STARTS: readonly number[] = B.sets.map((_, i) => B.sets.slice(0, i).reduce((a, s) => a + s.ms, 0));
export const TOTAL_MS = B.sets.reduce((a, s) => a + s.ms, 0);

export function setIndexAt(ms: number): number {
  let idx = 0;
  for (let i = 0; i < SET_STARTS.length; i++) if (ms >= SET_STARTS[i]) idx = i;
  return idx;
}

export interface Piece {
  /** PIECES 안의 번호 */
  id: number;
  /** [행, 열] 오프셋. 왼쪽 위가 [0, 0]. */
  cells: ReadonlyArray<readonly [number, number]>;
  w: number;
  h: number;
  /** 0 작은 것, 1 중간, 2 큰 것 */
  tier: 0 | 1 | 2;
  /** 1~5, 화면에서 악기 색을 고르는 번호 */
  color: number;
}

/** [tier, color, 모양]. '#'이 칸이다. 회전은 없어서 돌린 모양은 따로 적는다. */
const ART: ReadonlyArray<readonly [0 | 1 | 2, number, readonly string[]]> = [
  [0, 1, ['#']],
  [0, 1, ['##']],
  [0, 1, ['#', '#']],
  [0, 1, ['###']],
  [0, 1, ['#', '#', '#']],
  [0, 3, ['##', '##']],
  [0, 1, ['##', '#.']],
  [0, 1, ['##', '.#']],
  [0, 1, ['#.', '##']],
  [0, 1, ['.#', '##']],
  [1, 2, ['####']],
  [1, 2, ['#', '#', '#', '#']],
  [1, 3, ['###', '###']],
  [1, 3, ['##', '##', '##']],
  [1, 4, ['###', '.#.']],
  [1, 4, ['.#.', '###']],
  [1, 4, ['#.', '##', '#.']],
  [1, 4, ['.#', '##', '.#']],
  [1, 4, ['.##', '##.']],
  [1, 4, ['##.', '.##']],
  [1, 4, ['#.', '##', '.#']],
  [1, 4, ['.#', '##', '#.']],
  [1, 4, ['#.', '#.', '##']],
  [1, 4, ['.#', '.#', '##']],
  [1, 4, ['##', '#.', '#.']],
  [1, 4, ['##', '.#', '.#']],
  [2, 2, ['#####']],
  [2, 2, ['#', '#', '#', '#', '#']],
  [2, 3, ['###', '###', '###']],
  [2, 5, ['#..', '#..', '###']],
  [2, 5, ['..#', '..#', '###']],
  [2, 5, ['###', '#..', '#..']],
  [2, 5, ['###', '..#', '..#']],
  [2, 5, ['.#.', '###', '.#.']],
];

export const PIECES: readonly Piece[] = ART.map(([tier, color, rows], id) => {
  const cells: Array<readonly [number, number]> = [];
  rows.forEach((line, r) => [...line].forEach((ch, c) => ch === '#' && cells.push([r, c] as const)));
  return { id, cells, w: Math.max(...rows.map((l) => l.length)), h: rows.length, tier, color };
});

const PIECES_BY_TIER: readonly (readonly Piece[])[] = [0, 1, 2].map((t) => PIECES.filter((p) => p.tier === t));

/** piece를 (row, col)에 놓을 수 있나: 바닥 안이고 전부 빈 칸이어야 한다. */
export function fits(board: ArrayLike<number>, piece: Piece, row: number, col: number): boolean {
  if (row < 0 || col < 0 || row + piece.h > SIZE || col + piece.w > SIZE) return false;
  for (const [dr, dc] of piece.cells) if (board[(row + dr) * SIZE + col + dc] !== 0) return false;
  return true;
}

export function fitsAnywhere(board: ArrayLike<number>, piece: Piece): boolean {
  for (let r = 0; r + piece.h <= SIZE; r++) for (let c = 0; c + piece.w <= SIZE; c++) if (fits(board, piece, r, c)) return true;
  return false;
}

/** 가득 찬 가로줄·세로줄(불량 칸도 찬 칸으로 센다) */
function fullLines(board: ArrayLike<number>): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = 0; r < SIZE; r++) {
    let full = true;
    for (let c = 0; c < SIZE && full; c++) if (board[r * SIZE + c] === 0) full = false;
    if (full) rows.push(r);
  }
  for (let c = 0; c < SIZE; c++) {
    let full = true;
    for (let r = 0; r < SIZE && full; r++) if (board[r * SIZE + c] === 0) full = false;
    if (full) cols.push(c);
  }
  return { rows, cols };
}

/** 놓으면 터질 줄. 놓을 수 없는 자리면 빈 목록이다. 화면의 미리보기와 봇이 쓴다. */
export function previewClears(board: ArrayLike<number>, piece: Piece, row: number, col: number): { rows: number[]; cols: number[] } {
  if (!fits(board, piece, row, col)) return { rows: [], cols: [] };
  const copy = Uint8Array.from(board);
  for (const [dr, dc] of piece.cells) copy[(row + dr) * SIZE + col + dc] = piece.color;
  return fullLines(copy);
}

export type BlocksStatus = 'running' | 'finished';

export type BlockEvent =
  | { type: 'clear'; rows: number[]; cols: number[]; gained: number; combo: number }
  | { type: 'perfect' }
  | { type: 'set'; index: number }
  | { type: 'broken'; cells: number[] }
  | { type: 'rescue'; row: number; col: number }
  | { type: 'end'; stuck: boolean };

export type PlaceResult =
  | { ok: true; gained: number; rows: number[]; cols: number[]; combo: number; perfect: boolean }
  | { ok: false; reason: 'over' | 'empty' | 'blocked' };

export interface BlocksSummary {
  lines: number;
  pieces: number;
  bestCombo: number;
  perfects: number;
  rescues: number;
  seconds: number;
  /** 놓을 곳이 없어서 중간에 끝났다 */
  stuck: boolean;
}

export class BlocksGame {
  readonly persona: Persona;
  readonly seed: number;
  /** 0 빈 칸, 1~5 블록, BROKEN 불량 칸. 행 우선 SIZE×SIZE. */
  readonly board = new Uint8Array(CELLS);
  /** 손에 든 블록. 놓은 자리는 null. */
  hand: (Piece | null)[] = [];
  status: BlocksStatus = 'running';
  elapsedMs = 0;
  setIdx = 0;
  points = 0;
  combo = 0;
  bestCombo = 0;
  lines = 0;
  pieces = 0;
  perfects = 0;
  rescuesLeft: number;
  rescuesUsed = 0;
  stuck = false;
  /** 화면·효과음용 사건. 읽는 쪽이 비운다. */
  events: BlockEvent[] = [];
  private missStreak = 0;
  private deals = 0;

  constructor(persona: Persona, seed: number) {
    this.persona = persona;
    this.seed = seed >>> 0;
    this.rescuesLeft = B.persona[persona].rescues;
    this.addBroken(B.persona[persona].startBroken, mulberry32(mix(this.seed, 999)));
    this.events.length = 0;
    this.hand = this.deal();
  }

  /** 끝났는지 본다(타입이 상태 변화를 따라가지 못해서 함수로 읽는다) */
  get over(): boolean {
    return this.status === 'finished';
  }
  get setIndex(): number {
    return this.setIdx;
  }
  get totalMs(): number {
    return TOTAL_MS;
  }
  /** 이 곡이 끝날 때까지 남은 시간(ms) */
  get setRemainingMs(): number {
    const end = this.setIdx + 1 < SET_STARTS.length ? SET_STARTS[this.setIdx + 1] : TOTAL_MS;
    return Math.max(0, end - this.elapsedMs);
  }
  get progress(): number {
    return Math.min(1, this.elapsedMs / TOTAL_MS);
  }
  get setMult(): number {
    return B.sets[this.setIdx].mult;
  }
  /** 열기 점수 0~1000 */
  get score(): number {
    return Math.round(1000 * Math.min(1, this.points / B.persona[this.persona].target));
  }
  get cleared(): boolean {
    return this.score >= BALANCE.concert.clearScore;
  }
  get summary(): BlocksSummary {
    return {
      lines: this.lines,
      pieces: this.pieces,
      bestCombo: this.bestCombo,
      perfects: this.perfects,
      rescues: this.rescuesUsed,
      seconds: Math.round(this.elapsedMs / 1000),
      stuck: this.stuck,
    };
  }

  canPlace(handIndex: number, row: number, col: number): boolean {
    const p = this.hand[handIndex];
    return this.status === 'running' && !!p && fits(this.board, p, row, col);
  }

  /** 손의 handIndex번 블록을 (row, col)(블록의 왼쪽 위 칸)에 놓는다. */
  place(handIndex: number, row: number, col: number): PlaceResult {
    if (this.status !== 'running') return { ok: false, reason: 'over' };
    const piece = this.hand[handIndex];
    if (!piece) return { ok: false, reason: 'empty' };
    if (!fits(this.board, piece, row, col)) return { ok: false, reason: 'blocked' };
    for (const [dr, dc] of piece.cells) this.board[(row + dr) * SIZE + col + dc] = piece.color;
    this.hand[handIndex] = null;
    this.pieces += 1;

    const { rows, cols } = fullLines(this.board);
    const n = rows.length + cols.length;
    let raw = piece.cells.length * B.placePoint;
    let perfect = false;
    if (n > 0) {
      for (const r of rows) for (let c = 0; c < SIZE; c++) this.board[r * SIZE + c] = 0;
      for (const c of cols) for (let r = 0; r < SIZE; r++) this.board[r * SIZE + c] = 0;
      this.lines += n;
      this.combo += 1;
      this.missStreak = 0;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      raw += B.clearPoint * ((n * (n + 1)) / 2) * (1 + B.comboStep * Math.min(this.combo - 1, B.comboMax));
      perfect = this.board.every((v) => v === 0);
      if (perfect) {
        raw += B.perfectBonus;
        this.perfects += 1;
      }
    } else {
      this.missStreak += 1;
      if (this.missStreak > B.comboGrace) this.combo = 0;
    }
    const gained = raw * this.setMult;
    this.points += gained;
    if (n > 0) this.events.push({ type: 'clear', rows, cols, gained, combo: this.combo });
    if (perfect) this.events.push({ type: 'perfect' });

    if (this.hand.every((p) => p === null)) this.hand = this.deal();
    this.settle();
    return { ok: true, gained, rows, cols, combo: this.combo, perfect };
  }

  /** 실제 경과 시간을 넣는다. 곡이 바뀌면 불량 칸이 생기고, 공연 시간이 끝나면 끝난다. */
  advance(dtMs: number): void {
    if (this.status !== 'running') return;
    const to = Math.min(TOTAL_MS, this.elapsedMs + Math.max(0, Number.isFinite(dtMs) ? dtMs : 0));
    const idx = setIndexAt(to >= TOTAL_MS ? TOTAL_MS - 1 : to);
    for (let i = this.setIdx + 1; i <= idx; i++) {
      this.elapsedMs = SET_STARTS[i];
      this.setIdx = i;
      this.startSet(i);
      if (this.over) return;
    }
    this.elapsedMs = to;
    if (to >= TOTAL_MS) this.finish(false);
  }

  private startSet(i: number): void {
    this.events.push({ type: 'set', index: i });
    this.addBroken(B.persona[this.persona].brokenPerSet[i], mulberry32(mix(this.seed, 1000 + i)));
    this.settle();
  }

  private addBroken(count: number, rng: () => number): void {
    const empties: number[] = [];
    for (let i = 0; i < CELLS; i++) if (this.board[i] === 0) empties.push(i);
    const picked: number[] = [];
    for (let k = 0; k < count && empties.length > 0; k++) {
      const j = Math.floor(rng() * empties.length);
      const [cell] = empties.splice(j, 1);
      this.board[cell] = BROKEN;
      picked.push(cell);
    }
    if (picked.length > 0) this.events.push({ type: 'broken', cells: picked });
  }

  /** 새 블록 3개: 지금 바닥에 하나씩은 들어가는 조합을 찾고, 못 찾으면 들어가는 작은 것으로 채운다. */
  private deal(): Piece[] {
    const rng = mulberry32(mix(this.seed, 1 + this.deals++));
    const weights = B.persona[this.persona].tiers[this.setIdx];
    const total = weights.reduce<number>((a, w) => a + w, 0);
    const pick = (): Piece => {
      let x = rng() * total;
      let tier = 0;
      for (let t = 0; t < weights.length; t++) {
        x -= weights[t];
        if (x < 0) {
          tier = t;
          break;
        }
      }
      const pool = PIECES_BY_TIER[tier];
      return pool[Math.floor(rng() * pool.length)];
    };
    for (let attempt = 0; attempt < B.dealTries; attempt++) {
      const hand = Array.from({ length: B.hand }, pick);
      if (hand.every((p) => fitsAnywhere(this.board, p))) return hand;
    }
    const small = PIECES.filter((p) => p.tier === 0 && fitsAnywhere(this.board, p));
    if (small.length === 0) return Array.from({ length: B.hand }, () => PIECES[0]);
    return Array.from({ length: B.hand }, () => small[Math.floor(rng() * small.length)]);
  }

  private anyMove(): boolean {
    return this.hand.some((p) => p !== null && fitsAnywhere(this.board, p));
  }

  /** 놓을 곳이 없으면 구제(가장 찬 가로줄·세로줄 치우고 새 블록) 아니면 끝. */
  private settle(): void {
    if (this.status !== 'running' || this.anyMove()) return;
    if (this.rescuesLeft > 0) {
      this.rescuesLeft -= 1;
      this.rescuesUsed += 1;
      const filled = (cells: number[]) => cells.filter((i) => this.board[i] !== 0).length;
      const rowCells = (r: number) => Array.from({ length: SIZE }, (_, c) => r * SIZE + c);
      const colCells = (c: number) => Array.from({ length: SIZE }, (_, r) => r * SIZE + c);
      let row = 0;
      let col = 0;
      for (let i = 1; i < SIZE; i++) {
        if (filled(rowCells(i)) > filled(rowCells(row))) row = i;
        if (filled(colCells(i)) > filled(colCells(col))) col = i;
      }
      for (const i of rowCells(row)) this.board[i] = 0;
      for (const i of colCells(col)) this.board[i] = 0;
      this.events.push({ type: 'rescue', row, col });
      this.hand = this.deal();
      if (!this.anyMove()) this.finish(true);
      return;
    }
    this.finish(true);
  }

  private finish(stuck: boolean): void {
    this.status = 'finished';
    this.stuck = stuck;
    this.events.push({ type: 'end', stuck });
  }
}

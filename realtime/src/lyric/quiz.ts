/*
 * 가사 빈칸 속도전 방(순수 상태 기계). 시간·난수·보내기를 밖에서 받아서 테스트에서 시계를 마음대로 돌릴 수 있다.
 * 흐름: 대기실(lobby) → 문제(question) → 정답 공개(reveal) → 다음 문제 … → 결과(result) → 닫힘(closed).
 * 문제 수에 끝이 없다: 한 문제에서 한 명이라도 맞히면 계속 이어지고, 아무도 못 맞힌 문제가 나오면 그 공개 뒤에 결과로 넘어간다.
 * 출제 목록을 한 바퀴 다 돌면 다시 섞어서 이어 낸다(같은 줄이라도 비우는 구간은 새로 정한다).
 * 점수는 서버가 문제를 내고 정답을 판정하므로 위조할 수 없다. 방은 시작하면 새로 들어올 수 없다.
 */
import type { BoardRow, EndRow, PlayerRow, ServerMsg } from '../protocol.js';
import { shuffled } from '../rng.js';
import { isCorrect, makeBlank, type Blank } from './blank.js';

export const QUIZ = {
  capacity: 8,
  /** 첫 사람이 들어온 뒤 시작까지 기다리는 시간 */
  lobbyMs: 12_000,
  /** 정원이 다 차면 이 시간 뒤에 바로 시작 */
  fullStartMs: 3_000,
  answerMs: 20_000,
  /** 문제가 나온 뒤 이 시간이 지나면 정답의 첫 글자를 알려 준다 */
  hintMs: 9_000,
  revealMs: 5_000,
  resultMs: 15_000,
  /** 먼저 맞힐수록 높은 점수: 빨리 맞히면 baseMax, 시간이 다 돼 갈수록 baseMin 까지 줄어든다 */
  baseMax: 100,
  baseMin: 50,
  /** 1·2·3번째로 맞힌 사람이 더 받는 점수 */
  orderBonus: [30, 15, 5],
  /** 같은 사람이 답을 다시 보낼 수 있는 최소 간격 */
  answerGapMs: 150,
  /** 이 인원 이상으로 시작한 방만 다이아 보상이 나간다(혼자 연습은 보상 없음) */
  minHumans: 2,
  /** 1·2·3위 보상과, 한 문제라도 맞힌 나머지의 참가 보상(다이아) */
  rewards: [5, 3, 2],
  participation: 1,
} as const;

export type QuizPhase = 'lobby' | 'question' | 'reveal' | 'result' | 'closed';

export interface QuizOut {
  to(uid: string, msg: ServerMsg): void;
  all(msg: ServerMsg): void;
  /** 결과가 나왔다. rewarded가 참이면 rows의 reward 만큼 우편으로 보낸다. */
  finish(rows: EndRow[], rewarded: boolean): void;
}

interface Player extends PlayerRow {
  score: number;
  joinedAt: number;
  present: boolean;
  answered: boolean;
  gain: number;
  correct: number;
  lastAnsAt: number;
}

export class LyricRoom {
  phase: QuizPhase = 'lobby';
  private readonly players = new Map<string, Player>();
  /** 이번 바퀴에 낼 줄 번호 순서와 다음에 낼 자리 */
  private order: number[];
  private cursor = 0;
  /** 지금까지 낸 문제 수(진행 중인 문제 포함) */
  private round = 0;
  private blank: Blank | null = null;
  /** 방금 끝난 문제를 한 명이라도 맞혔는가(아니면 이 공개 뒤에 끝난다) */
  private lastSolved = true;
  private startAt = 0;
  private questionAt = 0;
  private phaseEnd = 0;
  private hinted = false;
  private places = 0;
  private startedHumans = 0;
  private readonly rng: () => number;

  constructor(
    readonly id: string,
    private readonly lines: readonly string[],
    rng: () => number,
    private readonly out: QuizOut,
  ) {
    this.rng = rng;
    this.order = this.shuffledOrder();
  }

  private shuffledOrder(): number[] {
    return shuffled(
      this.lines.map((_, i) => i),
      this.rng,
    );
  }

  /** 다음에 낼 줄. 한 바퀴를 다 돌면 다시 섞되, 방금 낸 줄이 바로 또 나오지는 않게 한다. */
  private nextLine(): string {
    if (this.cursor >= this.order.length) {
      const prev = this.order[this.order.length - 1];
      let next = this.shuffledOrder();
      if (next.length > 1 && next[0] === prev) next = [...next.slice(1), next[0]];
      this.order = next;
      this.cursor = 0;
    }
    return this.lines[this.order[this.cursor++]];
  }

  get size(): number {
    return [...this.players.values()].filter((p) => p.present).length;
  }

  /** 새로 들어올 수 있다: 대기실이고 정원이 안 찼다 */
  get joinable(): boolean {
    return this.phase === 'lobby' && this.size < QUIZ.capacity;
  }

  has(uid: string): boolean {
    return this.players.get(uid)?.present === true;
  }

  join(uid: string, name: string, now: number): boolean {
    if (this.has(uid)) return true;
    if (!this.joinable) return false;
    this.players.set(uid, { uid, name, score: 0, joinedAt: now, present: true, answered: false, gain: 0, correct: 0, lastAnsAt: -1e9 });
    if (this.size === 1) this.startAt = now + QUIZ.lobbyMs;
    if (this.size >= QUIZ.capacity) this.startAt = Math.min(this.startAt, now + QUIZ.fullStartMs);
    this.sendLobby(now);
    return true;
  }

  leave(uid: string, now: number): void {
    const p = this.players.get(uid);
    if (!p?.present) return;
    p.present = false;
    if (this.phase === 'lobby') {
      this.players.delete(uid);
      if (this.size === 0) this.phase = 'closed';
      else this.sendLobby(now);
      return;
    }
    if (this.size === 0 && this.phase !== 'result') this.phase = 'closed';
  }

  private present(): Player[] {
    return [...this.players.values()].filter((p) => p.present);
  }

  private sendLobby(now: number): void {
    const players = this.present().map(({ uid, name }) => ({ uid, name }));
    this.out.all({ t: 'l.lobby', players, startsInMs: Math.max(0, this.startAt - now), solo: players.length < QUIZ.minHumans });
  }

  /** 점수 높은 순(같으면 먼저 들어온 순)으로 나열한다. */
  private ranked(): Player[] {
    return this.present().sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  }

  private board(): BoardRow[] {
    return this.ranked().map((p) => ({ uid: p.uid, name: p.name, score: p.score, gain: p.gain }));
  }

  /** 정답을 쳤다. 맞으면 점수를 주고 true. */
  answer(uid: string, text: string, now: number): boolean {
    const p = this.players.get(uid);
    if (this.phase !== 'question' || !p?.present || p.answered || this.blank === null) return false;
    if (now - p.lastAnsAt < QUIZ.answerGapMs) return false;
    p.lastAnsAt = now;
    if (!isCorrect(this.blank, text)) {
      this.out.to(uid, { t: 'l.me', ok: false, gain: 0 });
      return false;
    }
    const used = Math.min(1, Math.max(0, (now - this.questionAt) / QUIZ.answerMs));
    const place = ++this.places;
    const gain = Math.round(QUIZ.baseMax - (QUIZ.baseMax - QUIZ.baseMin) * used + (QUIZ.orderBonus[place - 1] ?? 0));
    p.answered = true;
    p.gain = gain;
    p.score += gain;
    p.correct++;
    this.out.to(uid, { t: 'l.me', ok: true, gain });
    this.out.all({ t: 'l.ok', uid, name: p.name, gain, place });
    return true;
  }

  advance(now: number): void {
    switch (this.phase) {
      case 'lobby':
        if (this.size > 0 && now >= this.startAt) this.start(now);
        break;
      case 'question': {
        if (!this.hinted && now - this.questionAt >= QUIZ.hintMs && this.blank) {
          this.hinted = true;
          this.out.all({ t: 'l.hint', first: this.blank.answer.trim().charAt(0) });
        }
        const everyone = this.present().every((p) => p.answered);
        if (everyone || now >= this.phaseEnd) this.reveal(now);
        break;
      }
      case 'reveal':
        if (now >= this.phaseEnd) {
          if (!this.lastSolved || this.size === 0) this.finish(now);
          else this.beginRound(now);
        }
        break;
      case 'result':
        if (now >= this.phaseEnd) this.phase = 'closed';
        break;
      case 'closed':
        break;
    }
  }

  private start(now: number): void {
    this.startedHumans = this.size;
    this.beginRound(now);
  }

  private beginRound(now: number): void {
    this.round++;
    this.blank = makeBlank(this.nextLine(), this.rng);
    this.phase = 'question';
    this.questionAt = now;
    this.phaseEnd = now + QUIZ.answerMs;
    this.hinted = false;
    this.places = 0;
    for (const p of this.players.values()) {
      p.answered = false;
      p.gain = 0;
    }
    const { before, after, len } = this.blank;
    this.out.all({ t: 'l.q', round: this.round, before, after, len, endsInMs: QUIZ.answerMs });
  }

  private reveal(now: number): void {
    const b = this.blank;
    if (!b) return;
    this.phase = 'reveal';
    this.phaseEnd = now + QUIZ.revealMs;
    this.lastSolved = this.places > 0;
    this.out.all({ t: 'l.reveal', line: (b.before + b.answer + b.after).trim(), answer: b.answer.trim(), board: this.board(), nextInMs: QUIZ.revealMs, last: !this.lastSolved });
  }

  private finish(now: number): void {
    this.phase = 'result';
    this.phaseEnd = now + QUIZ.resultMs;
    const rewarded = this.startedHumans >= QUIZ.minHumans;
    const rows: EndRow[] = this.ranked().map((p, i) => {
      const rank = i + 1;
      const reward = !rewarded || p.correct === 0 ? 0 : (QUIZ.rewards[i] ?? QUIZ.participation);
      return { uid: p.uid, name: p.name, score: p.score, rank, reward };
    });
    this.out.all({ t: 'l.end', rows, rewarded, rounds: this.round });
    this.out.finish(rows, rewarded);
  }
}

/*
 * 가사 빈칸 속도전 내 기록(순수 규칙). 소켓 서버(realtime)가 판이 끝날 때 끝까지 남은 사람마다 한 판의 결과를 보내고,
 * 이 서버가 계정마다 누적·최고·최근 판으로 쌓는다. 모양은 소켓 프로토콜(`realtime/src/protocol.ts`)의 `LyricRecord`와 같아야 한다.
 * 판 점수는 소켓 서버가 계산하므로 요청에 상한만 둔다(이 주소는 공유 비밀 값이 있는 소켓 서버만 부른다).
 */
import { LIVE_REF_MAX } from './rules.js';

/** 최근 판을 몇 개까지 남기는가 */
export const RECENT_MAX = 10;

/** 한 판의 입력 상한(이상한 요청이 기록을 부풀리지 못하게 한다) */
export const RECORD_LIMITS = { players: 50, score: 1_000_000, correct: 10_000, rounds: 100_000 } as const;

export interface GameEntry {
  /** 같은 판의 기록을 두 번 쌓지 않게 하는 고유 값 */
  ref: string;
  /** 판이 끝난 시각(ms) */
  at: number;
  rank: number;
  players: number;
  score: number;
  correct: number;
  rounds: number;
  /** 2명 이상으로 시작한 판 */
  multi: boolean;
}

export interface RecordStats {
  games: number;
  multiGames: number;
  wins: number;
  totalCorrect: number;
  bestScore: number;
  bestCorrect: number;
}

export interface RecordDto extends RecordStats {
  recent: Omit<GameEntry, 'ref'>[];
}

export const EMPTY_STATS: RecordStats = { games: 0, multiGames: 0, wins: 0, totalCorrect: 0, bestScore: 0, bestCorrect: 0 };

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** 요청 본문을 한 판의 기록으로 읽는다. 모양이 이상하면 null. */
export function parseGameEntry(body: unknown, now: number): GameEntry | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.ref !== 'string' || b.ref.length === 0 || b.ref.length > LIVE_REF_MAX) return null;
  if (!isInt(b.players, 1, RECORD_LIMITS.players) || !isInt(b.rank, 1, b.players)) return null;
  if (!isInt(b.score, 0, RECORD_LIMITS.score) || !isInt(b.rounds, 1, RECORD_LIMITS.rounds) || !isInt(b.correct, 0, Math.min(RECORD_LIMITS.correct, b.rounds))) return null;
  if (typeof b.multi !== 'boolean') return null;
  return { ref: b.ref, at: now, rank: b.rank, players: b.players, score: b.score, correct: b.correct, rounds: b.rounds, multi: b.multi };
}

/** 한 판이 누적 수치에 더하는 양(데이터베이스의 `$inc`와 같은 값) */
export function incOf(e: GameEntry): Pick<RecordStats, 'games' | 'multiGames' | 'wins' | 'totalCorrect'> {
  return { games: 1, multiGames: e.multi ? 1 : 0, wins: e.multi && e.rank === 1 ? 1 : 0, totalCorrect: e.correct };
}

/**
 * 한 판을 쌓은 뒤의 기록과, 이 판으로 최고 기록을 새로 세웠는지(첫 판은 비교할 기록이 없어 아니다).
 * 데이터베이스는 `$inc`(incOf)·`$max`로 같은 계산을 원자적으로 한다.
 */
export function applyGame(before: RecordStats | null, e: GameEntry): { after: RecordStats; best: { score: boolean; correct: boolean } } {
  const b = before ?? EMPTY_STATS;
  const inc = incOf(e);
  const after: RecordStats = {
    games: b.games + inc.games,
    multiGames: b.multiGames + inc.multiGames,
    wins: b.wins + inc.wins,
    totalCorrect: b.totalCorrect + inc.totalCorrect,
    bestScore: Math.max(b.bestScore, e.score),
    bestCorrect: Math.max(b.bestCorrect, e.correct),
  };
  return { after, best: { score: b.games > 0 && e.score > b.bestScore, correct: b.games > 0 && e.correct > b.bestCorrect } };
}

/** 최근 판 목록에 한 판을 더한다(오래된 것부터, 최대 RECENT_MAX 개). */
export function pushRecent(recent: readonly GameEntry[], e: GameEntry): GameEntry[] {
  return [...recent, e].slice(-RECENT_MAX);
}

/** 보여 줄 기록(고유 값은 숨긴다) */
export function toRecordDto(stats: RecordStats | null, recent: readonly GameEntry[]): RecordDto {
  const s = stats ?? EMPTY_STATS;
  return {
    games: s.games,
    multiGames: s.multiGames,
    wins: s.wins,
    totalCorrect: s.totalCorrect,
    bestScore: s.bestScore,
    bestCorrect: s.bestCorrect,
    recent: recent.map(({ at, rank, players, score, correct, rounds, multi }) => ({ at, rank, players, score, correct, rounds, multi })),
  };
}

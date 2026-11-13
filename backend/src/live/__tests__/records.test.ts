import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, RECENT_MAX, RECORD_LIMITS, applyGame, incOf, parseGameEntry, pushRecent, toRecordDto, type GameEntry } from '../records.js';

const NOW = 1_700_000_000_000;
const body = (over: Record<string, unknown> = {}) => ({ uid: 'u', game: 'lyric', ref: 'l1:u', rank: 1, players: 3, score: 450, correct: 4, rounds: 6, multi: true, ...over });
const entry = (over: Partial<GameEntry> = {}): GameEntry => ({ ref: 'l1:u', at: NOW, rank: 1, players: 3, score: 450, correct: 4, rounds: 6, multi: true, ...over });

describe('가사 빈칸 속도전 기록: 요청 읽기', () => {
  it('올바른 요청은 판 기록이 되고 시각은 받은 시각이다', () => {
    expect(parseGameEntry(body(), NOW)).toEqual(entry());
  });

  it('모양이 이상하거나 상한을 넘으면 받지 않는다', () => {
    const bad: Record<string, unknown>[] = [
      { ref: '' },
      { ref: 'x'.repeat(81) },
      { ref: 5 },
      { rank: 0 },
      { rank: 4 }, // 순위가 사람 수보다 크다
      { rank: 1.5 },
      { players: 0 },
      { players: RECORD_LIMITS.players + 1 },
      { score: -1 },
      { score: RECORD_LIMITS.score + 1 },
      { score: 'a' },
      { correct: -1 },
      { correct: 7 }, // 맞힌 문제가 이어진 문제보다 많다
      { rounds: 0 },
      { multi: 'yes' },
    ];
    for (const o of bad) expect(parseGameEntry(body(o), NOW), JSON.stringify(o)).toBeNull();
    expect(parseGameEntry(null, NOW)).toBeNull();
    expect(parseGameEntry('x', NOW)).toBeNull();
    // 꽉 찬 방 같은 경계값은 받는다
    expect(parseGameEntry(body({ rank: 8, players: 8, correct: 0, score: 0, rounds: 1 }), NOW)).not.toBeNull();
  });
});

describe('가사 빈칸 속도전 기록: 쌓기', () => {
  it('첫 판: 누적이 생기고 최고 기록 표시는 없다(비교할 기록이 없다)', () => {
    const { after, best } = applyGame(null, entry());
    expect(after).toEqual({ games: 1, multiGames: 1, wins: 1, totalCorrect: 4, bestScore: 450, bestCorrect: 4 });
    expect(best).toEqual({ score: false, correct: false });
  });

  it('함께한 판의 1위만 승리로 세고, 혼자 한 판은 판 수와 정답 수에만 들어간다', () => {
    expect(incOf(entry({ rank: 2 }))).toEqual({ games: 1, multiGames: 1, wins: 0, totalCorrect: 4 });
    expect(incOf(entry({ rank: 1, multi: false, players: 1 }))).toEqual({ games: 1, multiGames: 0, wins: 0, totalCorrect: 4 });
  });

  it('점수나 정답 수의 최고를 넘으면 새 기록이고, 같거나 낮으면 아니다', () => {
    const before = { games: 3, multiGames: 2, wins: 1, totalCorrect: 10, bestScore: 500, bestCorrect: 5 };
    const higher = applyGame(before, entry({ score: 600, correct: 3 }));
    expect(higher.best).toEqual({ score: true, correct: false });
    expect(higher.after).toMatchObject({ games: 4, multiGames: 3, wins: 2, totalCorrect: 13, bestScore: 600, bestCorrect: 5 });
    const same = applyGame(before, entry({ score: 500, correct: 5 }));
    expect(same.best).toEqual({ score: false, correct: false });
    expect(same.after).toMatchObject({ bestScore: 500, bestCorrect: 5 });
    expect(applyGame(before, entry({ score: 10, correct: 9 })).best).toEqual({ score: false, correct: true });
  });

  it('값을 바꾸지 않는다', () => {
    const before = { ...EMPTY_STATS, games: 1, bestScore: 9 };
    applyGame(before, entry());
    expect(before).toEqual({ ...EMPTY_STATS, games: 1, bestScore: 9 });
  });
});

describe('가사 빈칸 속도전 기록: 최근 판과 보여 줄 모양', () => {
  it('최근 판은 오래된 것부터 최대 개수만 남긴다', () => {
    let recent: GameEntry[] = [];
    for (let i = 1; i <= RECENT_MAX + 3; i++) recent = pushRecent(recent, entry({ ref: `r${i}`, score: i }));
    expect(recent).toHaveLength(RECENT_MAX);
    expect(recent[0].score).toBe(4);
    expect(recent[RECENT_MAX - 1].score).toBe(RECENT_MAX + 3);
  });

  it('보여 줄 때는 고유 값을 숨기고, 기록이 없으면 0과 빈 목록이다', () => {
    const dto = toRecordDto({ ...EMPTY_STATS, games: 1 }, [entry()]);
    expect(dto.recent[0]).not.toHaveProperty('ref');
    expect(dto.recent[0]).toEqual({ at: NOW, rank: 1, players: 3, score: 450, correct: 4, rounds: 6, multi: true });
    expect(toRecordDto(null, [])).toEqual({ ...EMPTY_STATS, recent: [] });
  });
});

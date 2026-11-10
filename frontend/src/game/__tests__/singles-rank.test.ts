import { describe, expect, it } from 'vitest';
import * as server from '../../../../backend/src/saves/singles';
import { BALANCE } from '../balance';
import { createInitialState } from '../persistence';
import type { Single } from '../types';

describe('싱글 발매 수 랭킹: 서버 규칙과 게임 저장이 같은 모양을 본다', () => {
  it('서버의 싱글 상한이 BALANCE.maxSingles와 같다', () => {
    expect(server.MAX_SINGLES).toBe(BALANCE.maxSingles);
  });

  it('게임 저장의 singles(JSON으로 오간 모습)를 서버가 자아별로 센다', () => {
    const list: Single[] = [
      { id: 'single-1', persona: 'normal', title: 'a', releasedAt: 1 },
      { id: 'single-2', persona: 'dark', title: 'b', releasedAt: 2 },
      { id: 'single-3', persona: 'dark', title: 'c', releasedAt: 3 },
      { id: 'single-4', persona: 'normal', title: 'd', releasedAt: 4 },
      { id: 'single-5', persona: 'dark', title: 'e', releasedAt: 5 },
    ];
    const state = JSON.parse(JSON.stringify({ ...createInitialState(1_700_000_000_000), singles: list }));
    expect(server.singleCountsOf(state)).toEqual({ normal: 2, dark: 3 });
    expect(server.singleCountsOf(JSON.parse(JSON.stringify(createInitialState(1))))).toEqual({ normal: 0, dark: 0 });
  });
});

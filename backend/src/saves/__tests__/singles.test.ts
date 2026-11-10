import { describe, expect, it } from 'vitest';
import { MAX_SINGLES, singleCountsOf } from '../singles.js';

const single = (persona: unknown, i = 0) => ({ id: `single-${i + 1}`, persona, title: `곡 ${i + 1}`, releasedAt: 1000 + i });

describe('싱글 발매 수 세기', () => {
  it('자아별로 센다', () => {
    const state = { singles: [single('normal'), single('dark', 1), single('normal', 2), single('normal', 3), single('dark', 4)] };
    expect(singleCountsOf(state)).toEqual({ normal: 3, dark: 2 });
  });

  it('싱글이 없거나 목록이 아니면 0이다', () => {
    expect(singleCountsOf({})).toEqual({ normal: 0, dark: 0 });
    expect(singleCountsOf({ singles: [] })).toEqual({ normal: 0, dark: 0 });
    expect(singleCountsOf({ singles: 'x' })).toEqual({ normal: 0, dark: 0 });
    expect(singleCountsOf({ singles: { length: 9 } })).toEqual({ normal: 0, dark: 0 });
    expect(singleCountsOf(null)).toEqual({ normal: 0, dark: 0 });
    expect(singleCountsOf(undefined)).toEqual({ normal: 0, dark: 0 });
  });

  it('자아가 이상하거나 객체가 아닌 항목은 세지 않는다', () => {
    const state = { singles: [single('normal'), single('both', 1), single(undefined, 2), single(1, 3), null, 'normal', 7, [], single('dark', 8)] };
    expect(singleCountsOf(state)).toEqual({ normal: 1, dark: 1 });
  });

  it('게임의 상한(MAX_SINGLES)까지만 센다', () => {
    const state = { singles: Array.from({ length: MAX_SINGLES + 500 }, (_, i) => single(i % 2 === 0 ? 'normal' : 'dark', i)) };
    const c = singleCountsOf(state);
    expect(c.normal + c.dark).toBe(MAX_SINGLES);
  });
});

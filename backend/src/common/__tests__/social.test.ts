import { describe, expect, it } from 'vitest';
import { pairKey } from '../pair.js';
import { RateLimiter } from '../rate-limit.js';

describe('두 계정을 묶는 키', () => {
  it('순서와 상관없이 같고, 다른 짝은 다르다', () => {
    expect(pairKey('a1', 'b2')).toBe(pairKey('b2', 'a1'));
    expect(pairKey('a1', 'b2')).not.toBe(pairKey('a1', 'c3'));
  });
});

describe('도배 방지', () => {
  const limiter = () => new RateLimiter(1000, 3, 10_000);

  it('연속 전송 간격이 모자라면 막는다', () => {
    const l = limiter();
    l.check('u', 'a', 0);
    expect(() => l.check('u', 'b', 999)).toThrow(/너무 빨리/);
    expect(() => l.check('u', 'b', 1000)).not.toThrow();
  });

  it('1분에 정해진 개수를 넘기면 막고, 1분이 지나면 풀린다', () => {
    const l = limiter();
    l.check('u', 'a', 0);
    l.check('u', 'b', 1000);
    l.check('u', 'c', 2000);
    expect(() => l.check('u', 'd', 3000)).toThrow(/너무 빨리/);
    expect(() => l.check('u', 'd', 60_001)).not.toThrow();
  });

  it('같은 말은 반복 간격 안에 못 보내고, 다른 사람은 따로 센다', () => {
    const l = limiter();
    l.check('u', '안녕', 0);
    expect(() => l.check('u', '안녕', 2000)).toThrow(/반복/);
    expect(() => l.check('u', '안녕', 10_001)).not.toThrow();
    expect(() => l.check('other', '안녕', 10_002)).not.toThrow();
  });
});

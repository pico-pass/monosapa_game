import { describe, expect, it } from 'vitest';
import { LAUNCH, coinText, launchRef, newcomerEligible, planRankRewards, popupOpen, rankMailText, starterMailText } from '../rules.js';

const DAY = 86_400_000;
const e = (uid: string, level: number, fans: number) => ({ uid, level, fans });

/** 2026-11-12 운영 데이터의 상위 15명(레벨·팬) */
const SAMPLE = [
  e('a', 1006, 20_230_993),
  e('b', 72, 102_257),
  e('c', 50, 48_788),
  e('d', 27, 14_202),
  e('e', 26, 12_714),
  e('f', 19, 6_748),
  e('g', 14, 3_405),
  e('h', 12, 2_730),
  e('i', 11, 2_085),
  e('j', 10, 1_892),
  e('k', 10, 1_750),
  e('l', 9, 1_350),
  e('m', 8, 1_008),
  e('n', 7, 932),
  e('o', 7, 824),
  e('p', 4, 265),
];

describe('순위 보상', () => {
  const plan = planRankRewards(SAMPLE);

  it('상위 15명만 받고, 1위·2위는 고정 보상이다', () => {
    expect(plan).toHaveLength(15);
    expect(plan.map((r) => r.uid).join('')).toBe('abcdefghijklmno');
    expect(plan[0]).toMatchObject({ rank: 1, coins: 500_000_000, diamonds: 1000 });
    expect(plan[1]).toMatchObject({ rank: 2, coins: 300_000_000, diamonds: 300 });
  });

  it('3위 이하는 2위 보상에 레벨 비례(내 레벨 ÷ 2위 레벨)로 주고, 순위가 내려갈수록 줄어든다', () => {
    const byRank = Object.fromEntries(plan.map((r) => [r.rank, r]));
    expect(byRank[3]).toMatchObject({ diamonds: 208, coins: 208_000_000 }); // 300 × 50/72
    expect(byRank[4]).toMatchObject({ diamonds: 113, coins: 113_000_000 }); // 300 × 27/72 = 112.5
    expect(byRank[8]).toMatchObject({ diamonds: 50, coins: 50_000_000 });
    expect(byRank[15]).toMatchObject({ diamonds: 29, coins: 29_000_000 });
    for (let i = 3; i < 15; i++) {
      expect(byRank[i + 1].diamonds).toBeLessThanOrEqual(byRank[i].diamonds);
      expect(byRank[i + 1].coins).toBeLessThanOrEqual(byRank[i].coins);
    }
    expect(byRank[3].coins).toBeLessThan(LAUNCH.second.coins);
  });

  it('입력 순서와 상관없이 레벨 → 팬 수 순으로 순위를 매기고, 같으면 uid 순이다', () => {
    const shuffled = [...SAMPLE].reverse();
    expect(planRankRewards(shuffled).map((r) => r.uid)).toEqual(plan.map((r) => r.uid));
    const tie = planRankRewards([e('z', 5, 100), e('y', 5, 100), e('x', 5, 300)]);
    expect(tie.map((r) => r.uid)).toEqual(['x', 'y', 'z']);
  });

  it('팬이 없는 계정과 이상한 값은 순위에 넣지 않고, 사람이 15명보다 적어도 된다', () => {
    const few = planRankRewards([e('a', 3, 500), e('b', 1, 0), e('c', Number.NaN, 10)]);
    expect(few.map((r) => r.uid)).toEqual(['a']);
    expect(few[0]).toMatchObject({ rank: 1, ...LAUNCH.first });
    expect(planRankRewards([])).toEqual([]);
  });

  it('레벨이 낮아도 최소 보상(💎1·코인 1M)은 받는다', () => {
    const low = planRankRewards([e('a', 100, 1e6), e('b', 1000, 1e9), e('c', 1, 1)]);
    const c = low.find((r) => r.uid === 'c')!;
    expect(c.rank).toBe(3);
    expect(c.diamonds).toBeGreaterThanOrEqual(1);
    expect(c.coins).toBeGreaterThanOrEqual(LAUNCH.coinStep);
  });
});

describe('스타트 패키지·팝업 기간', () => {
  const launched = Date.UTC(2026, 10, 14);

  it('출시 뒤 7일 안에 가입한 계정만 신규 패키지를 받는다(출시 전 계정은 초기화 때 우편으로 받았다)', () => {
    expect(newcomerEligible(launched - 1, launched)).toBe(false);
    expect(newcomerEligible(launched, launched)).toBe(true);
    expect(newcomerEligible(launched + 7 * DAY - 1, launched)).toBe(true);
    expect(newcomerEligible(launched + 7 * DAY, launched)).toBe(false);
  });

  it('환영 팝업은 출시 시각부터 14일 동안이다', () => {
    expect(popupOpen(launched, launched - 1)).toBe(false);
    expect(popupOpen(launched, launched)).toBe(true);
    expect(popupOpen(launched, launched + 14 * DAY - 1)).toBe(true);
    expect(popupOpen(launched, launched + 14 * DAY)).toBe(false);
  });

  it('스타트 패키지는 코인 1억·다이아 150이다', () => {
    expect(LAUNCH.starter).toEqual({ coins: 100_000_000, diamonds: 150 });
  });
});

describe('우편 문구와 키', () => {
  it('제목은 우편 제목 상한(30자) 안이고 보상 내용이 들어 있다', () => {
    const rank = rankMailText({ rank: 3, coins: 208_000_000, diamonds: 208 });
    expect(rank.title.length).toBeLessThanOrEqual(30);
    expect(rank.title).toContain('3위');
    expect(rank.body).toContain('208M');
    expect(rank.body).toContain('💎 208');
    const starter = starterMailText();
    expect(starter.title.length).toBeLessThanOrEqual(30);
    expect(starter.body).toContain('100M');
    expect(starter.body).toContain('💎 150');
  });

  it('코인 표기와 중복 방지 키', () => {
    expect(coinText(500_000_000)).toBe('500M');
    expect(coinText(2_500_000)).toBe('2.5M');
    expect(coinText(999)).toBe('999');
    expect(launchRef('starter', 'u1')).toBe('launch:starter:u1');
    expect(launchRef('rank', 'u1')).not.toBe(launchRef('starter', 'u1'));
  });
});

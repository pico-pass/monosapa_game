import { describe, expect, it } from 'vitest';
import { BOSS_KINDS, DAILY_HITS, MIN_TARGET, ROSTER, TIER_COUNT, TIER_REWARDS, bossOf, hitDamage, isBossKind, rankReward, targetOf, tierOf, tierRewardSum } from '../roster.js';

describe('이번 주 보스', () => {
  it('주 번호로 5종이 돌아가고 음수 주도 안전하다', () => {
    expect(ROSTER).toHaveLength(5);
    expect(bossOf(0).id).toBe(ROSTER[0].id);
    expect(bossOf(5).id).toBe(ROSTER[0].id);
    expect(bossOf(7).id).toBe(ROSTER[2].id);
    expect(bossOf(-1).id).toBe(ROSTER[4].id);
  });

  it('약점이 5종 게임에 하나씩 겹치지 않게 걸려 있다', () => {
    // 보스마다 약점이 서로 다르고 모두 알려진 판 종류다(약점이 안 되는 종류는 데미지만 들어간다)
    expect(new Set(ROSTER.map((b) => b.weak)).size).toBe(ROSTER.length);
    for (const b of ROSTER) expect(BOSS_KINDS).toContain(b.weak);
    expect(ROSTER.every((b) => isBossKind(b.weak))).toBe(true);
  });

  it('아케이드 새 게임 넷도 데미지가 되지만 약점은 아니다', () => {
    for (const kind of ['slash', 'hole', 'gate', 'plinko'] as const) {
      expect(isBossKind(kind)).toBe(true);
      expect(ROSTER.some((b) => b.weak === kind)).toBe(false);
      const hit = hitDamage(kind, 800, ROSTER[0].weak);
      expect(hit.weak).toBe(false);
      expect(hit.damage).toBe(80);
    }
  });

  it('종류 검사는 알려진 문자열만 받는다', () => {
    expect(isBossKind('rhythm')).toBe(true);
    expect(isBossKind('ticketing')).toBe(false);
    expect(isBossKind(3)).toBe(false);
  });
});

describe('판 하나의 데미지', () => {
  it('점수/10을 반올림하고 약점은 2배, 900점 이상은 크리티컬 1.5배다', () => {
    expect(hitDamage('rhythm', 500, 'lyric')).toEqual({ damage: 50, weak: false, crit: false });
    expect(hitDamage('lyric', 500, 'lyric')).toEqual({ damage: 100, weak: true, crit: false });
    expect(hitDamage('rhythm', 900, 'lyric')).toEqual({ damage: 135, weak: false, crit: true });
    expect(hitDamage('lyric', 1000, 'lyric')).toEqual({ damage: 300, weak: true, crit: true });
  });

  it('점수는 0~1000으로 잘리고 비정상 값은 0점이다', () => {
    expect(hitDamage('rhythm', -50, 'lyric').damage).toBe(0);
    expect(hitDamage('rhythm', 99999, 'lyric').damage).toBe(150);
    expect(hitDamage('rhythm', NaN, 'lyric').damage).toBe(0);
  });

  it('한 사람이 하루에 낼 수 있는 최대 데미지가 정해져 있다', () => {
    expect(DAILY_HITS * hitDamage('lyric', 1000, 'lyric').damage).toBe(3000);
  });
});

describe('목표와 단계', () => {
  it('첫 주는 활성 계정 수에 비례하고 하한이 있다', () => {
    expect(targetOf(0, 1)).toBe(MIN_TARGET);
    expect(targetOf(0, 100)).toBe(150_000);
  });

  it('다음 주 목표는 지난주 총합의 1.15배를 하한·상한 안으로 자른다', () => {
    expect(targetOf(100_000, 100)).toBe(115_000);
    expect(targetOf(1_000, 100)).toBe(80_000); // 하한: 100명 × 800
    expect(targetOf(100_000_000, 100)).toBe(800_000); // 상한: 100명 × 8000
  });

  it('단계는 총 데미지가 목표의 i/5에 닿을 때마다 열리고 5단계가 끝이다', () => {
    expect(tierOf(0, 1000)).toBe(0);
    expect(tierOf(199, 1000)).toBe(0);
    expect(tierOf(200, 1000)).toBe(1);
    expect(tierOf(999, 1000)).toBe(4);
    expect(tierOf(1000, 1000)).toBe(TIER_COUNT);
    expect(tierOf(5000, 1000)).toBe(TIER_COUNT);
    expect(tierOf(100, 0)).toBe(0);
  });

  it('단계 보상 합은 받은 단계부터 닿은 단계 직전까지다', () => {
    expect(TIER_REWARDS).toEqual([1, 1, 2, 2, 4]);
    expect(tierRewardSum(0, 5)).toBe(10);
    expect(tierRewardSum(2, 4)).toBe(4);
    expect(tierRewardSum(3, 3)).toBe(0);
    expect(tierRewardSum(0, 99)).toBe(10);
  });
});

describe('지난주 순위 보상', () => {
  it('상위 1%는 5, 10%는 3, 50%는 1이고 그 밖은 0이다', () => {
    expect(rankReward(1, 100)).toBe(5);
    expect(rankReward(2, 100)).toBe(3);
    expect(rankReward(10, 100)).toBe(3);
    expect(rankReward(11, 100)).toBe(1);
    expect(rankReward(50, 100)).toBe(1);
    expect(rankReward(51, 100)).toBe(0);
  });

  it('인원이 적어도 1등은 5를 받고 순위·인원이 이상하면 0이다', () => {
    expect(rankReward(1, 1)).toBe(5);
    expect(rankReward(1, 3)).toBe(5);
    expect(rankReward(0, 10)).toBe(0);
    expect(rankReward(1, 0)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { LIVE_DAILY_CAP, LIVE_GAMES, LIVE_MAX_REWARD, grantedOf, isLiveGame, liveMailTitle } from '../rules.js';

/** 우편 제목의 최대 길이(`MailboxService`의 MAIL_TITLE_MAX. 서비스 파일은 테스트에서 가져오지 못해 값을 적어 둔다) */
const MAIL_TITLE_MAX = 30;

describe('라이브 보상 규칙', () => {
  it('하루 한도 안에서만 내준다', () => {
    expect(grantedOf(0, 5)).toBe(5);
    expect(grantedOf(LIVE_DAILY_CAP - 2, 5)).toBe(2);
    expect(grantedOf(LIVE_DAILY_CAP, 5)).toBe(0);
    expect(grantedOf(LIVE_DAILY_CAP + 3, 5)).toBe(0);
    expect(grantedOf(0, LIVE_MAX_REWARD)).toBeLessThanOrEqual(LIVE_DAILY_CAP);
  });

  it('게임 이름 확인과 우편 제목', () => {
    for (const g of LIVE_GAMES) expect(isLiveGame(g)).toBe(true);
    expect(isLiveGame('boss')).toBe(false);
    expect(isLiveGame(1)).toBe(false);
    expect(liveMailTitle('가사 빈칸 속도전 1위')).toBe('라이브 보상 · 가사 빈칸 속도전 1위');
  });

  it('가장 긴 이름표도 우편 제목 길이 안에 들어간다', () => {
    expect(liveMailTitle('가사 빈칸 속도전 참가').length).toBeLessThanOrEqual(MAIL_TITLE_MAX);
    expect(liveMailTitle('팬덤 모으기 99999명').length).toBeLessThanOrEqual(MAIL_TITLE_MAX);
  });
});

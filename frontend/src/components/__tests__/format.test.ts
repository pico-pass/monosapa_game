import { describe, expect, it } from 'vitest';
import { ONLINE_WITHIN_MS, fmtSeen } from '../format';

describe('프로필 접속 상태', () => {
  it('3분 안이면 접속 중이다', () => {
    expect(fmtSeen(0)).toEqual({ online: true, text: '접속 중' });
    expect(fmtSeen(ONLINE_WITHIN_MS - 1)).toEqual({ online: true, text: '접속 중' });
  });

  it('그 뒤로는 n분·n시간·n일 전 접속으로 보인다', () => {
    expect(fmtSeen(ONLINE_WITHIN_MS)).toEqual({ online: false, text: '3분 전 접속' });
    expect(fmtSeen(12 * 60_000 + 59_000).text).toBe('12분 전 접속');
    expect(fmtSeen(59 * 60_000).text).toBe('59분 전 접속');
    expect(fmtSeen(60 * 60_000).text).toBe('1시간 전 접속');
    expect(fmtSeen(23 * 3600_000 + 59 * 60_000).text).toBe('23시간 전 접속');
    expect(fmtSeen(24 * 3600_000).text).toBe('1일 전 접속');
    expect(fmtSeen(10 * 24 * 3600_000).text).toBe('10일 전 접속');
  });

  it('기록이 없으면 접속 기록 없음', () => {
    expect(fmtSeen(null)).toEqual({ online: false, text: '접속 기록 없음' });
    expect(fmtSeen(undefined).text).toBe('접속 기록 없음');
  });
});

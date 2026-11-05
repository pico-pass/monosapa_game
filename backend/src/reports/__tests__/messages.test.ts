import { describe, expect, it } from 'vitest';
import { kst, muteMail, reporterMail, warnMail } from '../messages.js';

describe('신고 처리 우편', () => {
  it('한국 시간으로 적는다', () => {
    expect(kst(Date.UTC(2026, 10, 5, 0, 0))).toBe('2026-11-05 09:00');
    expect(kst(Date.UTC(2026, 10, 5, 15, 30))).toBe('2026-11-06 00:30');
  });

  it('경고: 사유와 운영자 안내가 들어간다', () => {
    const m = warnMail('욕설·비방', '다시는 하지 마세요');
    expect(m.title).toContain('경고');
    expect(m.body).toContain('욕설·비방');
    expect(m.body).toContain('다시는 하지 마세요');
  });

  it('이용 제한: 시간과 풀리는 한국 시간이 들어간다', () => {
    const m = muteMail('도배·광고', '광고 금지', 72, Date.UTC(2026, 10, 8, 0, 0));
    expect(m.title).toContain('이용 제한');
    expect(m.body).toContain('72시간');
    expect(m.body).toContain('2026-11-08 09:00');
    expect(m.body).toContain('광고 금지');
  });

  it('신고한 사람에게: 기각과 조치가 다르게 안내된다', () => {
    expect(reporterMail('dismiss').body).toContain('조치하지 않았어요');
    expect(reporterMail('warn').body).toContain('조치했어요');
    expect(reporterMail('mute').body).toContain('조치했어요');
  });
});

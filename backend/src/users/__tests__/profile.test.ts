import { describe, expect, it } from 'vitest';
import { AVATARS, COSTUME_IDS, FRIEND_CODE_LENGTH, assertNotMuted, displayNameOf, isAvatar, mutedUntilMs, newFriendCode, normalizeFriendCode } from '../profile.js';

describe('프로필 사진 종류', () => {
  it('구글·일반·어둠과 코스튬 21종(costume-ID)만 고를 수 있다', () => {
    expect(COSTUME_IDS).toHaveLength(21);
    expect(new Set(COSTUME_IDS).size).toBe(21);
    expect(AVATARS).toHaveLength(3 + 21);
    for (const ok of ['google', 'normal', 'dark', 'costume-maid', 'costume-dbride']) expect(isAvatar(ok)).toBe(true);
    for (const id of COSTUME_IDS) expect(isAvatar(`costume-${id}`)).toBe(true);
  });

  it('없는 코스튬·다른 모양·문자열이 아닌 값은 거부한다', () => {
    for (const bad of ['costume-nope', 'costume-', 'costume', 'maid', 'Costume-maid', 'costume-maid ', '', 'admin', null, undefined, 1, {}, ['dark']]) {
      expect(isAvatar(bad)).toBe(false);
    }
  });
});

describe('프로필 규칙', () => {
  it('보여 줄 이름: 닉네임 → 구글 이름 → 익명', () => {
    expect(displayNameOf({ nickname: ' 사파 ', name: '홍길동' })).toBe('사파');
    expect(displayNameOf({ nickname: null, name: '홍길동' })).toBe('홍길동');
    expect(displayNameOf({ nickname: '  ', name: ' ' })).toBe('익명');
    expect(displayNameOf({})).toBe('익명');
  });

  it('친구 코드: 길이와 글자 모양이 맞고 헷갈리는 글자가 없다', () => {
    for (let i = 0; i < 200; i++) {
      const code = newFriendCode();
      expect(code).toHaveLength(FRIEND_CODE_LENGTH);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
      expect(normalizeFriendCode(code)).toBe(code);
    }
  });

  it('친구 코드 입력: 공백·하이픈·소문자를 정리하고 형태가 틀리면 null', () => {
    expect(normalizeFriendCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeFriendCode('ABCD234')).toBeNull(); // 7자
    expect(normalizeFriendCode('ABCD23456')).toBeNull(); // 9자
    expect(normalizeFriendCode('ABCD234O')).toBeNull(); // O는 쓰지 않는 글자
    expect(normalizeFriendCode('ABCD2341')).toBeNull(); // 1도 쓰지 않는다
    expect(normalizeFriendCode(12345678)).toBeNull();
  });

  it('이용 제한: 제한 시각이 지나지 않았을 때만 제한 중이다', () => {
    const now = 1_700_000_000_000;
    expect(mutedUntilMs({ mutedUntil: new Date(now + 1000) }, now)).toBe(now + 1000);
    expect(mutedUntilMs({ mutedUntil: new Date(now - 1) }, now)).toBeNull();
    expect(mutedUntilMs({ mutedUntil: null }, now)).toBeNull();
    expect(mutedUntilMs({}, now)).toBeNull();
  });

  it('이용 제한 중이면 막고, 메시지에 풀리는 한국 시간이 들어간다', () => {
    const now = Date.UTC(2026, 10, 5, 0, 0); // 한국 시간 2026-11-05 09:00
    expect(() => assertNotMuted({ mutedUntil: null }, '글을 쓸', now)).not.toThrow();
    expect(() => assertNotMuted({ mutedUntil: now - 1 }, '글을 쓸', now)).not.toThrow();
    expect(() => assertNotMuted({ mutedUntil: Date.UTC(2026, 10, 6, 0, 0) }, '챗방에 글을 쓸', now)).toThrow(/챗방에 글을 쓸 수 없어요.*2026-11-06 09:00/);
  });
});

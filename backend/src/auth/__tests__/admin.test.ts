import { describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, isAdminEmail } from '../admin.js';

describe('관리자 판별', () => {
  it('관리자는 ESCN 계정 하나뿐이다', () => {
    expect(ADMIN_EMAIL).toBe('lsh34206@gmail.com');
    expect(isAdminEmail('lsh34206@gmail.com')).toBe(true);
  });

  it('대소문자·앞뒤 공백은 같은 계정으로 본다', () => {
    expect(isAdminEmail('LSH34206@Gmail.com')).toBe(true);
    expect(isAdminEmail('  lsh34206@gmail.com ')).toBe(true);
  });

  it('다른 이메일과 이메일이 없는 계정은 관리자가 아니다', () => {
    expect(isAdminEmail('someone@gmail.com')).toBe(false);
    expect(isAdminEmail('lsh34206@gmail.com.evil.com')).toBe(false);
    expect(isAdminEmail('xlsh34206@gmail.com')).toBe(false);
    expect(isAdminEmail('')).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});

import type { User } from './user.schema.js';

/** 프로필에 보여 줄 「마지막 접속이 몇 ms 전인가」. 접속 신호가 없던 예전 계정은 마지막 로그인 시각을 쓰고, 둘 다 없으면 null이다. */
export function seenAgoMs(u: Pick<User, 'lastSeenAt' | 'lastLoginAt'>, now: number = Date.now()): number | null {
  const at = u.lastSeenAt ?? u.lastLoginAt;
  return at ? Math.max(0, now - at.getTime()) : null;
}

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

/**
 * 소켓 서버(realtime)만 부르는 내부 주소의 공유 비밀 값(`x-realtime-secret`) 확인.
 * 비밀 값이 설정되지 않았으면 없는 주소처럼 동작한다(404). nginx 는 /api/internal/ 을 바깥에 열지 않는다.
 */
export function assertRealtime(secret: string | undefined, expected: string): void {
  if (!expected) throw new NotFoundException();
  if (typeof secret !== 'string' || !timingSafeEqual(digest(secret), digest(expected))) throw new ForbiddenException();
}

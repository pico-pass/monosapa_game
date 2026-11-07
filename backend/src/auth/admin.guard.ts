import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthedRequest } from './session.guard.js';

/** SessionGuard 뒤에 붙인다. 관리자 계정(`admin.ts`의 ADMIN_EMAIL)이 아니면 막는다. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user?.isAdmin) throw new ForbiddenException('관리자만 할 수 있어요.');
    return true;
  }
}

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../config/app.config.js';
import { AuthService } from './auth.service.js';
import { readCookie } from './cookie.js';
import type { UserDto } from './dto/auth.dto.js';

/** 로그인(세션 쿠키)이 필요한 라우트에 붙인다. 통과하면 req.user 에 계정이 들어 있다. */
export type AuthedRequest = Request & { user: UserDto };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.findUserByToken(readCookie(req, this.config.sessionCookieName));
    if (!user) throw new UnauthorizedException('로그인이 필요해요.');
    req.user = user;
    return true;
  }
}

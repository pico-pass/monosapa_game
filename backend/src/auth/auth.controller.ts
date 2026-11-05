import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfig } from '../config/app.config.js';
import { AuthService } from './auth.service.js';
import { readCookie } from './cookie.js';
import { SessionGuard, type AuthedRequest } from './session.guard.js';
import { AuthConfigDto, GoogleLoginDto, MeDto } from './dto/auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Get('config')
  getConfig(): AuthConfigDto {
    return { googleClientId: this.config.googleClientId };
  }

  @Post('google')
  @HttpCode(200)
  async google(@Body() body: GoogleLoginDto | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<MeDto> {
    const { token, maxAgeMs, user } = await this.auth.loginWithGoogle(body?.credential);
    res.cookie(this.config.sessionCookieName, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: maxAgeMs });
    return { user };
  }

  @Get('me')
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<MeDto> {
    res.setHeader('Cache-Control', 'no-store');
    const user = await this.auth.findUserByToken(readCookie(req, this.config.sessionCookieName));
    if (user) await this.auth.ping(user.id);
    return { user };
  }

  /** 접속 신호: 로그인한 사람이 화면을 보고 있다는 표시. 다른 사람의 프로필에 「접속 중」·「n분 전 접속」으로 보인다. */
  @Post('ping')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async ping(@Req() req: AuthedRequest): Promise<void> {
    await this.auth.ping(req.user.id);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readCookie(req, this.config.sessionCookieName));
    res.clearCookie(this.config.sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
  }
}

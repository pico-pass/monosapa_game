import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfig } from '../config/app.config.js';
import { AuthService } from './auth.service.js';
import { readCookie } from './cookie.js';
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
    return { user: await this.auth.findUserByToken(readCookie(req, this.config.sessionCookieName)) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readCookie(req, this.config.sessionCookieName));
    res.clearCookie(this.config.sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
  }
}

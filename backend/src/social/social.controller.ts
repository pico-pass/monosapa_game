import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { SocialSummaryDto } from './dto/social.dto.js';
import { SocialService } from './social.service.js';

/** 우편·친구 요청·개인채팅의 새 소식 개수. 앱이 주기적으로 불러 알림 점을 그린다. */
@Controller('social')
@UseGuards(SessionGuard)
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('summary')
  summary(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<SocialSummaryDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.social.summary(req.user);
  }
}

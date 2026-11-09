import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { BossService } from './boss.service.js';
import type { BossClaimDto, BossDto, BossHitBodyDto, BossHitResultDto } from './dto/boss.dto.js';

/** 월드 보스: 한 주 동안 모두의 점수가 데미지로 쌓인다. 로그인한 사람은 누구나 보고 칠 수 있다. */
@Controller('boss')
@UseGuards(SessionGuard)
export class BossController {
  constructor(private readonly boss: BossService) {}

  @Get()
  overview(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<BossDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.boss.overview(req.user);
  }

  @Post('hit')
  hit(@Req() req: AuthedRequest, @Body() body: BossHitBodyDto | undefined): Promise<BossHitResultDto> {
    return this.boss.hit(req.user, body);
  }

  @Post('claim')
  claim(@Req() req: AuthedRequest): Promise<BossClaimDto> {
    return this.boss.claim(req.user);
  }

  @Post('claim-last')
  claimLast(@Req() req: AuthedRequest): Promise<BossClaimDto> {
    return this.boss.claimLast(req.user);
  }
}

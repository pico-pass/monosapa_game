import { Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { FlagClaimDto, FlagPendingDto, FlagSentDto, VillageViewDto } from './dto/village.dto.js';
import { VillageService } from './village.service.js';

/** 팬 마을: 친구 마을 보기·응원 깃발. 마을 자체의 규칙은 서버에 없고(저장 JSON) 사람끼리 만나는 부분만 여기 있다. */
@Controller('village')
@UseGuards(SessionGuard)
export class VillageController {
  constructor(private readonly village: VillageService) {}

  // 고정 경로(flags)를 변수 라우트(:uid)보다 먼저 선언한다.
  @Get('flags')
  pending(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<FlagPendingDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.village.pending(req.user.id);
  }

  @Post('flags/claim')
  claim(@Req() req: AuthedRequest): Promise<FlagClaimDto> {
    return this.village.claim(req.user.id);
  }

  @Get(':uid')
  view(@Req() req: AuthedRequest, @Param('uid') uid: string, @Res({ passthrough: true }) res: Response): Promise<VillageViewDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.village.view(req.user, uid);
  }

  @Post(':uid/flag')
  flag(@Req() req: AuthedRequest, @Param('uid') uid: string): Promise<FlagSentDto> {
    return this.village.flag(req.user, uid);
  }
}

import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { RankingDto, TowerRankingDto } from './dto/ranking.dto.js';
import { RankingService } from './ranking.service.js';

/** 계정 레벨 랭킹과 무한의 계단 랭킹. 로그인한 사람만 볼 수 있다. */
@Controller('ranking')
@UseGuards(SessionGuard)
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  @Get()
  top(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<RankingDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.ranking.top(req.user.id);
  }

  @Get('tower')
  tower(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<TowerRankingDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.ranking.towerTop(req.user.id);
  }
}

import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { NurtureRankingDto, RankingDto, SinglesRankingDto, TowerRankingDto, VillageRankingDto } from './dto/ranking.dto.js';
import { RankingService } from './ranking.service.js';

/** 계정 레벨·무한의 계단·모노사파 육성·팬 마을·싱글 발매 수 랭킹. 로그인한 사람만 볼 수 있다. */
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

  @Get('nurture')
  nurture(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<NurtureRankingDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.ranking.nurtureTop(req.user.id);
  }

  @Get('village')
  village(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<VillageRankingDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.ranking.villageTop(req.user.id);
  }

  @Get('singles/normal')
  singlesNormal(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<SinglesRankingDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.ranking.singlesTop(req.user.id, 'normal');
  }

  @Get('singles/dark')
  singlesDark(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<SinglesRankingDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.ranking.singlesTop(req.user.id, 'dark');
  }
}

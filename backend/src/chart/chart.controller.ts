import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { ChartService } from './chart.service.js';
import type { ChartClaimDto, ChartDto } from './dto/chart.dto.js';

/** 실시간 음원 차트. 모든 계정의 싱글과 NPC 곡이 함께 순위를 겨룬다. */
@Controller('chart')
@UseGuards(SessionGuard)
export class ChartController {
  constructor(private readonly chart: ChartService) {}

  @Get()
  get(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<ChartDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.chart.chart(req.user);
  }

  @Post('claim')
  claim(@Req() req: AuthedRequest): Promise<ChartClaimDto> {
    return this.chart.claim(req.user);
  }
}

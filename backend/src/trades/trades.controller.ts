import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { PostTradeDto, TradeAcceptDto, TradeCardDto, TradeDto, TradesDto } from './dto/trade.dto.js';
import { TradesService } from './trades.service.js';

/** 포토카드 교환소. 로그인한 사람만 쓸 수 있다. */
@Controller('trades')
@UseGuards(SessionGuard)
export class TradesController {
  constructor(private readonly trades: TradesService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<TradesDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.trades.list(req.user);
  }

  @Post()
  post(@Req() req: AuthedRequest, @Body() body: PostTradeDto | undefined): Promise<TradeDto> {
    return this.trades.post(req.user, body);
  }

  @Post(':id/accept')
  accept(@Req() req: AuthedRequest, @Param('id') id: string): Promise<TradeAcceptDto> {
    return this.trades.accept(req.user, id);
  }

  @Post(':id/collect')
  collect(@Req() req: AuthedRequest, @Param('id') id: string): Promise<TradeCardDto> {
    return this.trades.collect(req.user, id);
  }

  @Post(':id/cancel')
  cancel(@Req() req: AuthedRequest, @Param('id') id: string): Promise<TradeCardDto> {
    return this.trades.cancel(req.user, id);
  }
}

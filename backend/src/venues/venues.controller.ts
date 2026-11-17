import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { MyVenueDto, SaveVenueDto, VenueClaimDto, VenueLikeDto, VenueListDto, VenuePlayDto } from './dto/venues.dto.js';
import { VenuesService } from './venues.service.js';

/** 무대 디자인 빌더 「내 무대」: 내 무대 올리기, 둘러보기, 남의 무대에서 공연, 좋아요, 지난주 인기 보상. */
@Controller('venues')
@UseGuards(SessionGuard)
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  // 고정 경로(me, claim-weekly)를 변수 라우트(:id)보다 먼저 선언한다.
  @Get('me')
  mine(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<MyVenueDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.venues.mine(req.user);
  }

  @Put('me')
  save(@Req() req: AuthedRequest, @Body() body: SaveVenueDto | undefined): Promise<MyVenueDto> {
    return this.venues.save(req.user, body);
  }

  @Post('claim-weekly')
  claimWeekly(@Req() req: AuthedRequest): Promise<VenueClaimDto> {
    return this.venues.claimWeekly(req.user);
  }

  @Get()
  list(@Req() req: AuthedRequest, @Query('sort') sort: unknown, @Query('page') page: unknown, @Res({ passthrough: true }) res: Response): Promise<VenueListDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.venues.list(req.user, sort, page);
  }

  @Post(':id/play')
  play(@Req() req: AuthedRequest, @Param('id') id: string): Promise<VenuePlayDto> {
    return this.venues.play(req.user, id);
  }

  @Post(':id/like')
  like(@Req() req: AuthedRequest, @Param('id') id: string): Promise<VenueLikeDto> {
    return this.venues.like(req.user, id);
  }
}

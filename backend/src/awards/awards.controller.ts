import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { AwardsBoardService } from './awards-board.service.js';
import type { AwardClaimDto, AwardVoteDto, AwardsDto } from './dto/awards.dto.js';

/** 시상식 「모노사파 어워즈」. 단계별 화면 자료·팬 투표상 투표·보상 받기. */
@Controller('awards')
@UseGuards(SessionGuard)
export class AwardsController {
  constructor(private readonly board: AwardsBoardService) {}

  @Get()
  overview(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<AwardsDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.board.overview(req.user);
  }

  @Post('vote')
  vote(@Req() req: AuthedRequest, @Body() body: Partial<AwardVoteDto> | undefined): Promise<AwardVoteDto> {
    return this.board.vote(req.user, body) as Promise<AwardVoteDto>;
  }

  @Post('claim')
  claim(@Req() req: AuthedRequest): Promise<AwardClaimDto> {
    return this.board.claim(req.user);
  }
}

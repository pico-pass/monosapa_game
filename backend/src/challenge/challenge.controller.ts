import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { ChallengeService } from './challenge.service.js';
import type { ChallengeClaimDto, ChallengeDto, ChallengeEntryDto, ChallengeLikeDto, PostChallengeDto } from './dto/challenge.dto.js';

/** 주간 해시태그 챌린지. 로그인한 사람은 누구나 읽고 한 줄을 올릴 수 있다. */
@Controller('challenge')
@UseGuards(SessionGuard)
export class ChallengeController {
  constructor(private readonly challenge: ChallengeService) {}

  @Get()
  overview(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<ChallengeDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.challenge.overview(req.user);
  }

  @Post()
  post(@Req() req: AuthedRequest, @Body() body: PostChallengeDto | undefined): Promise<ChallengeEntryDto> {
    return this.challenge.post(req.user, body);
  }

  @Post('claim')
  claim(@Req() req: AuthedRequest): Promise<ChallengeClaimDto> {
    return this.challenge.claim(req.user);
  }

  @Post(':id/like')
  like(@Req() req: AuthedRequest, @Param('id') id: string): Promise<ChallengeLikeDto> {
    return this.challenge.like(req.user, id);
  }

  @Post(':id/report')
  @HttpCode(204)
  report(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    return this.challenge.report(req.user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    return this.challenge.remove(req.user, id);
  }
}

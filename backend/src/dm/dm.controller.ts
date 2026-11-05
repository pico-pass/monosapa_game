import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { DmMessageDto, DmThreadDto, SendDmDto } from './dto/dm.dto.js';
import { DmService } from './dm.service.js';

/** 친구끼리의 개인채팅. 친구가 아니면 읽지도 쓰지도 못한다. */
@Controller('dm')
@UseGuards(SessionGuard)
export class DmController {
  constructor(private readonly dm: DmService) {}

  @Get(':uid')
  thread(@Req() req: AuthedRequest, @Param('uid') uid: string, @Res({ passthrough: true }) res: Response): Promise<DmThreadDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.dm.thread(req.user, uid);
  }

  @Post(':uid')
  send(@Req() req: AuthedRequest, @Param('uid') uid: string, @Body() body: SendDmDto | undefined): Promise<DmMessageDto> {
    return this.dm.send(req.user, uid, body);
  }
}

import { Body, Controller, Get, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { GetSaveDto, PutSaveDto, PutSaveResultDto } from './dto/save.dto.js';
import { SavesService } from './saves.service.js';

/** 로그인한 계정의 게임 저장. */
@Controller('saves')
@UseGuards(SessionGuard)
export class SavesController {
  constructor(private readonly saves: SavesService) {}

  @Get('me')
  async getMine(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<GetSaveDto> {
    res.setHeader('Cache-Control', 'no-store');
    return { save: await this.saves.get(req.user.id) };
  }

  @Put('me')
  putMine(@Req() req: AuthedRequest, @Body() body: PutSaveDto | undefined): Promise<PutSaveResultDto> {
    return this.saves.put(req.user.id, body);
  }
}

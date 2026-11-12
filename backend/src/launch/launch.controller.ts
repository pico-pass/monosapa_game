import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { LaunchEnterDto } from './dto/launch.dto.js';
import { LaunchService } from './launch.service.js';

/** 정식 출시 안내. 게임에 들어올 때 부른다. */
@Controller('launch')
@UseGuards(SessionGuard)
export class LaunchController {
  constructor(private readonly launch: LaunchService) {}

  @Post('enter')
  enter(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<LaunchEnterDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.launch.enter(req.user);
  }
}

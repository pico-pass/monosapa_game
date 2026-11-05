import { Body, Controller, Get, Param, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { MyProfileDto, ProfileDto, UpdateProfileDto } from './dto/profiles.dto.js';
import { ProfilesService } from './profiles.service.js';

/** 프로필 설정과 다른 사람의 프로필 보기. 로그인한 사람만 쓸 수 있고 이메일은 내려주지 않는다. */
@Controller('profiles')
@UseGuards(SessionGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  // 'me'·'code/:code' 는 ':uid' 보다 먼저 선언해 uid 로 읽히지 않게 한다.
  @Get('me')
  me(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<MyProfileDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.profiles.me(req.user);
  }

  @Put('me')
  update(@Req() req: AuthedRequest, @Body() body: UpdateProfileDto | undefined): Promise<MyProfileDto> {
    return this.profiles.update(req.user, body);
  }

  @Get('code/:code')
  byCode(@Req() req: AuthedRequest, @Param('code') code: string, @Res({ passthrough: true }) res: Response): Promise<ProfileDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.profiles.byCode(req.user, code);
  }

  @Get(':uid')
  byUid(@Req() req: AuthedRequest, @Param('uid') uid: string, @Res({ passthrough: true }) res: Response): Promise<ProfileDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.profiles.byUid(req.user, uid);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { FriendsDto, GiftResultDto, RequestFriendDto, RequestResultDto } from './dto/friends.dto.js';
import { FriendsService } from './friends.service.js';

/** 친구: 목록·요청·수락·삭제와 하루 한 번 다이아 선물. 로그인한 사람만 쓸 수 있다. */
@Controller('friends')
@UseGuards(SessionGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<FriendsDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.friends.list(req.user);
  }

  @Post('requests')
  request(@Req() req: AuthedRequest, @Body() body: RequestFriendDto | undefined): Promise<RequestResultDto> {
    return this.friends.request(req.user, body?.uid);
  }

  @Post('requests/:uid/accept')
  @HttpCode(204)
  accept(@Req() req: AuthedRequest, @Param('uid') uid: string): Promise<void> {
    return this.friends.accept(req.user, uid);
  }

  /** 받은 요청 거절 · 보낸 요청 취소 */
  @Delete('requests/:uid')
  @HttpCode(204)
  cancel(@Req() req: AuthedRequest, @Param('uid') uid: string): Promise<void> {
    return this.friends.cancel(req.user, uid);
  }

  @Post(':uid/gift')
  gift(@Req() req: AuthedRequest, @Param('uid') uid: string): Promise<GiftResultDto> {
    return this.friends.gift(req.user, uid);
  }

  @Delete(':uid')
  @HttpCode(204)
  remove(@Req() req: AuthedRequest, @Param('uid') uid: string): Promise<void> {
    return this.friends.remove(req.user, uid);
  }
}

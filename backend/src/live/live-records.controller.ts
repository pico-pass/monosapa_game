import { Body, Controller, Get, Headers, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { AppConfig } from '../config/app.config.js';
import type { LiveRecordBodyDto, LiveRecordResultDto, MyLiveRecordsDto } from './dto/live.dto.js';
import { assertRealtime } from './internal.js';
import { LiveRecordsService } from './live-records.service.js';

/** 내 라이브 미니게임 기록(로그인 필요) */
@Controller('live/records')
@UseGuards(SessionGuard)
export class LiveRecordsController {
  constructor(private readonly records: LiveRecordsService) {}

  @Get('me')
  mine(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<MyLiveRecordsDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.records.mine(req.user.id);
  }
}

/**
 * 소켓 서버(realtime)가 판이 끝난 사람의 기록을 쌓는 내부 주소. 로그인 쿠키가 아니라 공유 비밀 값(`x-realtime-secret`)으로 확인한다.
 * 비밀 값이 설정되지 않았으면 없는 주소처럼 동작한다. nginx 는 이 주소(/api/internal/)를 바깥에 열지 않는다.
 */
@Controller('internal/live-record')
export class LiveRecordInternalController {
  constructor(
    private readonly records: LiveRecordsService,
    private readonly config: AppConfig,
  ) {}

  @Post()
  save(@Headers('x-realtime-secret') secret: string | undefined, @Body() body: LiveRecordBodyDto | undefined): Promise<LiveRecordResultDto> {
    assertRealtime(secret, this.config.realtimeSecret);
    return this.records.record(body);
  }
}

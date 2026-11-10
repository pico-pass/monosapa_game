import { Body, Controller, ForbiddenException, Headers, NotFoundException, Post } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/app.config.js';
import type { LiveRewardBodyDto, LiveRewardResultDto } from './dto/live.dto.js';
import { LiveService } from './live.service.js';

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

/**
 * 소켓 서버(realtime)가 라이브 미니게임 보상 우편을 요청하는 내부 주소. 로그인 쿠키가 아니라 공유 비밀 값(`x-realtime-secret`)으로 확인한다.
 * 비밀 값이 설정되지 않았으면 없는 주소처럼 동작한다. nginx 는 이 주소(/api/internal/)를 바깥에 열지 않는다.
 */
@Controller('internal/live-reward')
export class LiveController {
  constructor(
    private readonly live: LiveService,
    private readonly config: AppConfig,
  ) {}

  @Post()
  grant(@Headers('x-realtime-secret') secret: string | undefined, @Body() body: LiveRewardBodyDto | undefined): Promise<LiveRewardResultDto> {
    const expected = this.config.realtimeSecret;
    if (!expected) throw new NotFoundException();
    if (typeof secret !== 'string' || !timingSafeEqual(digest(secret), digest(expected))) throw new ForbiddenException();
    return this.live.grant(body);
  }
}

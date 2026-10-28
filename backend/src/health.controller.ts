import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /** 상태 확인 API. 게임 규칙은 아직 서버에 없다(저장은 프런트엔드 localStorage). */
  @Get()
  check() {
    return { status: 'ok', service: 'monosapa-backend', time: new Date().toISOString() };
  }
}

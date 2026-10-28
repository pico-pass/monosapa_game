import { Injectable } from '@nestjs/common';
import { HealthStatusDto } from './dto/health-status.dto.js';

@Injectable()
export class HealthService {
  private readonly serviceName = 'monosapa-backend';

  /** 서버가 살아 있는지 알려 준다. 게임 규칙은 아직 서버에 없다(저장은 프런트엔드 localStorage). */
  getStatus(): HealthStatusDto {
    return new HealthStatusDto('ok', this.serviceName, new Date().toISOString());
  }
}

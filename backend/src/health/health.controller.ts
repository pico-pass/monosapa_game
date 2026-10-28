import { Controller, Get } from '@nestjs/common';
import { HealthStatusDto } from './dto/health-status.dto.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): HealthStatusDto {
    return this.healthService.getStatus();
  }
}

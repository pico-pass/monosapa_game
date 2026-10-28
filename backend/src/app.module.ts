import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';

/** 루트 모듈. 기능은 기능별 모듈로 나눠 여기서 가져온다. */
@Module({
  imports: [HealthModule],
})
export class AppModule {}

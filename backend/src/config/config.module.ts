import { Global, Module } from '@nestjs/common';
import { AppConfig } from './app.config.js';

/** 설정 객체를 어느 모듈에서나 주입받게 한다. */
@Global()
@Module({
  providers: [{ provide: AppConfig, useValue: new AppConfig() }],
  exports: [AppConfig],
})
export class ConfigModule {}

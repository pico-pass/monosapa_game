import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app.config.js';

async function bootstrap(): Promise<void> {
  const config = new AppConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // nginx 뒤에서 돌므로 X-Forwarded-Proto 를 믿어야 req.secure 로 https 여부를 알 수 있다. (세션 쿠키의 Secure 속성)
  app.set('trust proxy', 1);
  // 게임 저장(PUT /api/saves/me)은 기본 한도(100kb)보다 커질 수 있다. 서버 쪽 상한은 saves.service.ts 가 따로 건다.
  app.useBodyParser('json', { limit: '1.2mb' });
  app.setGlobalPrefix(config.globalPrefix);
  app.enableCors({ origin: [...config.corsOrigins], credentials: true });
  await app.listen(config.port);
  console.log(`backend listening on http://localhost:${config.port}/${config.globalPrefix}`);
}

void bootstrap();

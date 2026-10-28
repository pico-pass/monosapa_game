import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // 개발 중 프런트엔드(Vite)가 직접 호출해도 되도록 로컬 오리진만 허용한다.
  app.enableCors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`backend listening on http://localhost:${port}/api`);
}

void bootstrap();

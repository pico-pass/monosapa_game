import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app.config.js';

async function bootstrap(): Promise<void> {
  const config = new AppConfig();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(config.globalPrefix);
  app.enableCors({ origin: [...config.corsOrigins] });
  await app.listen(config.port);
  console.log(`backend listening on http://localhost:${config.port}/${config.globalPrefix}`);
}

void bootstrap();

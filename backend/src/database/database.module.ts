import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfig } from '../config/app.config.js';

/** MongoDB 연결. 접속하지 못하면 5초 뒤 시작을 실패시켜 pm2가 상태를 바로 드러내게 한다. */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({ uri: config.mongoUri, serverSelectionTimeoutMS: 5000 }),
    }),
  ],
})
export class DatabaseModule {}

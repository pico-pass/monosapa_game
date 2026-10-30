import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { Save, SaveSchema } from '../saves/save.schema.js';
import { User, UserSchema } from '../users/user.schema.js';
import { RankingController } from './ranking.controller.js';
import { RankingService } from './ranking.service.js';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Save.name, schema: SaveSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [RankingController],
  providers: [RankingService],
})
export class RankingModule {}

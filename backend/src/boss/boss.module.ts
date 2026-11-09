import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { Save, SaveSchema } from '../saves/save.schema.js';
import { User, UserSchema } from '../users/user.schema.js';
import { BossController } from './boss.controller.js';
import { BossLog, BossLogSchema, BossPlayer, BossPlayerSchema, BossWeek, BossWeekSchema } from './boss.schema.js';
import { BossService } from './boss.service.js';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: BossWeek.name, schema: BossWeekSchema },
      { name: BossPlayer.name, schema: BossPlayerSchema },
      { name: BossLog.name, schema: BossLogSchema },
      { name: Save.name, schema: SaveSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [BossController],
  providers: [BossService],
  exports: [BossService],
})
export class BossModule {}

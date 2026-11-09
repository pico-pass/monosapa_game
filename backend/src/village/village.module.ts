import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { FriendsModule } from '../friends/friends.module.js';
import { Save, SaveSchema } from '../saves/save.schema.js';
import { User, UserSchema } from '../users/user.schema.js';
import { VillageController } from './village.controller.js';
import { VillageFlag, VillageFlagSchema } from './village.schema.js';
import { VillageService } from './village.service.js';

@Module({
  imports: [
    AuthModule,
    FriendsModule,
    MongooseModule.forFeature([
      { name: VillageFlag.name, schema: VillageFlagSchema },
      { name: Save.name, schema: SaveSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [VillageController],
  providers: [VillageService],
  exports: [VillageService],
})
export class VillageModule {}

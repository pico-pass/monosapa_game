import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { FriendsModule } from '../friends/friends.module.js';
import { User, UserSchema } from '../users/user.schema.js';
import { DirectMessage, DirectMessageSchema } from './direct-message.schema.js';
import { DmController } from './dm.controller.js';
import { DmService } from './dm.service.js';

@Module({
  imports: [
    AuthModule,
    FriendsModule,
    MongooseModule.forFeature([
      { name: DirectMessage.name, schema: DirectMessageSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [DmController],
  providers: [DmService],
})
export class DmModule {}

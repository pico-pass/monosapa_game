import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { BossModule } from '../boss/boss.module.js';
import { DirectMessage, DirectMessageSchema } from '../dm/direct-message.schema.js';
import { FriendsModule } from '../friends/friends.module.js';
import { MailboxModule } from '../mailbox/mailbox.module.js';
import { VillageModule } from '../village/village.module.js';
import { SocialController } from './social.controller.js';
import { SocialService } from './social.service.js';

@Module({
  imports: [AuthModule, MailboxModule, FriendsModule, VillageModule, BossModule, MongooseModule.forFeature([{ name: DirectMessage.name, schema: DirectMessageSchema }])],
  controllers: [SocialController],
  providers: [SocialService],
})
export class SocialModule {}

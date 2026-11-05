import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { DirectMessage, DirectMessageSchema } from '../dm/direct-message.schema.js';
import { MailboxModule } from '../mailbox/mailbox.module.js';
import { Save, SaveSchema } from '../saves/save.schema.js';
import { User, UserSchema } from '../users/user.schema.js';
import { FriendsController } from './friends.controller.js';
import { FriendsService } from './friends.service.js';
import { FriendGift, FriendGiftSchema } from './gift.schema.js';
import { Friendship, FriendshipSchema } from './friendship.schema.js';

@Module({
  imports: [
    AuthModule,
    MailboxModule,
    MongooseModule.forFeature([
      { name: Friendship.name, schema: FriendshipSchema },
      { name: FriendGift.name, schema: FriendGiftSchema },
      { name: User.name, schema: UserSchema },
      { name: Save.name, schema: SaveSchema },
      { name: DirectMessage.name, schema: DirectMessageSchema },
    ]),
  ],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}

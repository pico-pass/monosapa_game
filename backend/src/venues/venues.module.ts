import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { FriendsModule } from '../friends/friends.module.js';
import { MailboxModule } from '../mailbox/mailbox.module.js';
import { Save, SaveSchema } from '../saves/save.schema.js';
import { User, UserSchema } from '../users/user.schema.js';
import { Venue, VenueClaim, VenueClaimSchema, VenueLike, VenueLikeSchema, VenuePlay, VenuePlaySchema, VenueSchema } from './venue.schema.js';
import { VenuesController } from './venues.controller.js';
import { VenuesService } from './venues.service.js';

@Module({
  imports: [
    AuthModule,
    FriendsModule,
    MailboxModule,
    MongooseModule.forFeature([
      { name: Venue.name, schema: VenueSchema },
      { name: VenueLike.name, schema: VenueLikeSchema },
      { name: VenuePlay.name, schema: VenuePlaySchema },
      { name: VenueClaim.name, schema: VenueClaimSchema },
      { name: Save.name, schema: SaveSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [VenuesController],
  providers: [VenuesService],
  exports: [VenuesService],
})
export class VenuesModule {}

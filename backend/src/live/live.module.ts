import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailboxModule } from '../mailbox/mailbox.module.js';
import { LiveController } from './live.controller.js';
import { LiveDaily, LiveDailySchema, LiveReward, LiveRewardSchema } from './live.schema.js';
import { LiveService } from './live.service.js';

@Module({
  imports: [
    MailboxModule,
    MongooseModule.forFeature([
      { name: LiveReward.name, schema: LiveRewardSchema },
      { name: LiveDaily.name, schema: LiveDailySchema },
    ]),
  ],
  controllers: [LiveController],
  providers: [LiveService],
})
export class LiveModule {}

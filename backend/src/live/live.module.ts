import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { MailboxModule } from '../mailbox/mailbox.module.js';
import { LiveRecordInternalController, LiveRecordsController } from './live-records.controller.js';
import { LiveRecordsService } from './live-records.service.js';
import { LiveController } from './live.controller.js';
import { LiveDaily, LiveDailySchema, LiveRecord, LiveRecordSchema, LiveReward, LiveRewardSchema } from './live.schema.js';
import { LiveService } from './live.service.js';

@Module({
  imports: [
    AuthModule,
    MailboxModule,
    MongooseModule.forFeature([
      { name: LiveReward.name, schema: LiveRewardSchema },
      { name: LiveDaily.name, schema: LiveDailySchema },
      { name: LiveRecord.name, schema: LiveRecordSchema },
    ]),
  ],
  controllers: [LiveController, LiveRecordsController, LiveRecordInternalController],
  providers: [LiveService, LiveRecordsService],
})
export class LiveModule {}

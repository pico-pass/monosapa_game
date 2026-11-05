import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { ChatMessage, ChatMessageSchema } from '../chat/chat.schema.js';
import { DirectMessage, DirectMessageSchema } from '../dm/direct-message.schema.js';
import { MailboxModule } from '../mailbox/mailbox.module.js';
import { User, UserSchema } from '../users/user.schema.js';
import { Report, ReportSchema } from './report.schema.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [
    AuthModule,
    MailboxModule,
    MongooseModule.forFeature([
      { name: Report.name, schema: ReportSchema },
      { name: User.name, schema: UserSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: DirectMessage.name, schema: DirectMessageSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}

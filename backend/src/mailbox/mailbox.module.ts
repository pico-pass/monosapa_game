import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { User, UserSchema } from '../users/user.schema.js';
import { Mail, MailSchema } from './mail.schema.js';
import { MailboxController } from './mailbox.controller.js';
import { MailboxService } from './mailbox.service.js';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Mail.name, schema: MailSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [MailboxController],
  providers: [MailboxService],
  exports: [MailboxService],
})
export class MailboxModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { MailboxModule } from '../mailbox/mailbox.module.js';
import { User, UserSchema } from '../users/user.schema.js';
import { LaunchController } from './launch.controller.js';
import { LaunchGrant, LaunchGrantSchema, LaunchMeta, LaunchMetaSchema } from './launch.schema.js';
import { LaunchService } from './launch.service.js';

@Module({
  imports: [
    AuthModule,
    MailboxModule,
    MongooseModule.forFeature([
      { name: LaunchMeta.name, schema: LaunchMetaSchema },
      { name: LaunchGrant.name, schema: LaunchGrantSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [LaunchController],
  providers: [LaunchService],
  exports: [LaunchService],
})
export class LaunchModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { User, UserSchema } from '../users/user.schema.js';
import { ChallengeController } from './challenge.controller.js';
import { ChallengeEntry, ChallengeEntrySchema } from './challenge.schema.js';
import { ChallengeService } from './challenge.service.js';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: ChallengeEntry.name, schema: ChallengeEntrySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ChallengeController],
  providers: [ChallengeService],
})
export class ChallengeModule {}

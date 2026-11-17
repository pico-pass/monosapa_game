import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { ChartModule } from '../chart/chart.module.js';
import { Save, SaveSchema } from '../saves/save.schema.js';
import { User, UserSchema } from '../users/user.schema.js';
import { AwardsBoardService } from './awards-board.service.js';
import { AwardsController } from './awards.controller.js';
import { AwardClaim, AwardClaimSchema, AwardEdition, AwardEditionSchema, AwardPoint, AwardPointSchema, AwardTick, AwardTickSchema, AwardVote, AwardVoteSchema } from './awards.schema.js';
import { AwardsService } from './awards.service.js';

@Module({
  imports: [
    AuthModule,
    ChartModule,
    MongooseModule.forFeature([
      { name: AwardTick.name, schema: AwardTickSchema },
      { name: AwardPoint.name, schema: AwardPointSchema },
      { name: AwardEdition.name, schema: AwardEditionSchema },
      { name: AwardVote.name, schema: AwardVoteSchema },
      { name: AwardClaim.name, schema: AwardClaimSchema },
      { name: Save.name, schema: SaveSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [AwardsController],
  providers: [AwardsService, AwardsBoardService],
  exports: [AwardsService, AwardsBoardService],
})
export class AwardsModule {}

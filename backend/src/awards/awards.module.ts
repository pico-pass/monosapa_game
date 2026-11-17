import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChartModule } from '../chart/chart.module.js';
import { AwardPoint, AwardPointSchema, AwardTick, AwardTickSchema } from './awards.schema.js';
import { AwardsService } from './awards.service.js';

@Module({
  imports: [
    ChartModule,
    MongooseModule.forFeature([
      { name: AwardTick.name, schema: AwardTickSchema },
      { name: AwardPoint.name, schema: AwardPointSchema },
    ]),
  ],
  providers: [AwardsService],
  exports: [AwardsService],
})
export class AwardsModule {}

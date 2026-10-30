import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { Save, SaveSchema } from '../saves/save.schema.js';
import { User, UserSchema } from '../users/user.schema.js';
import { ChartController } from './chart.controller.js';
import { ChartClaim, ChartClaimSchema } from './chart.schema.js';
import { ChartService } from './chart.service.js';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Save.name, schema: SaveSchema },
      { name: User.name, schema: UserSchema },
      { name: ChartClaim.name, schema: ChartClaimSchema },
    ]),
  ],
  controllers: [ChartController],
  providers: [ChartService],
})
export class ChartModule {}

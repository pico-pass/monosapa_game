import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { User, UserSchema } from '../users/user.schema.js';
import { Trade, TradeSchema } from './trade.schema.js';
import { TradesController } from './trades.controller.js';
import { TradesService } from './trades.service.js';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Trade.name, schema: TradeSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [TradesController],
  providers: [TradesService],
})
export class TradesModule {}

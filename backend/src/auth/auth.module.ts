import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module.js';
import { AdminGuard } from './admin.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleVerifierService } from './google-verifier.service.js';
import { SessionGuard } from './session.guard.js';
import { Session, SessionSchema } from './session.schema.js';

@Module({
  imports: [UsersModule, MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }])],
  controllers: [AuthController],
  providers: [AuthService, GoogleVerifierService, SessionGuard, AdminGuard],
  exports: [AuthService, SessionGuard, AdminGuard],
})
export class AuthModule {}

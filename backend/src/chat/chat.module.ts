import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { ChatController } from './chat.controller.js';
import { ChatMessage, ChatMessageSchema } from './chat.schema.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AuthModule, MongooseModule.forFeature([{ name: ChatMessage.name, schema: ChatMessageSchema }])],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { ChatService } from './chat.service.js';
import type { ChatListDto, ChatMessageDto, PostChatDto } from './dto/chat.dto.js';

/** 공개 자유 챗방. 로그인한 사람은 누구나 읽고 쓸 수 있다. */
@Controller('chat')
@UseGuards(SessionGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<ChatListDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.chat.list(req.user);
  }

  @Post()
  post(@Req() req: AuthedRequest, @Body() body: PostChatDto | undefined): Promise<ChatMessageDto> {
    return this.chat.post(req.user, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    return this.chat.remove(req.user, id);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard.js';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { AdminMailDto, AdminMailResultDto, MailClaimDto, MailboxDto } from './dto/mailbox.dto.js';
import { MailboxService } from './mailbox.service.js';

/** 우편함. 친구의 선물과 운영 안내가 온다. 다이아가 붙은 우편은 받기를 눌러야 반영된다. */
@Controller('mailbox')
@UseGuards(SessionGuard)
export class MailboxController {
  constructor(private readonly mailbox: MailboxService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<MailboxDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.mailbox.list(req.user);
  }

  @Post('read-all')
  @HttpCode(204)
  readAll(@Req() req: AuthedRequest): Promise<void> {
    return this.mailbox.readAll(req.user);
  }

  @Post('claim-all')
  claimAll(@Req() req: AuthedRequest): Promise<MailClaimDto> {
    return this.mailbox.claimAll(req.user);
  }

  @Delete()
  @HttpCode(204)
  removeDone(@Req() req: AuthedRequest): Promise<void> {
    return this.mailbox.removeDone(req.user);
  }

  // 아래 관리자 라우트는 ':id' 보다 먼저 선언해 'admin' 이 id 로 읽히지 않게 한다.
  @Post('admin/send')
  @UseGuards(AdminGuard)
  adminSend(@Body() body: AdminMailDto | undefined): Promise<AdminMailResultDto> {
    return this.mailbox.adminSend(body);
  }

  @Post(':id/claim')
  claim(@Req() req: AuthedRequest, @Param('id') id: string): Promise<MailClaimDto> {
    return this.mailbox.claim(req.user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    return this.mailbox.remove(req.user, id);
  }
}

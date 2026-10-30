import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard.js';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { CreateInquiryDto, InquiryDto, InquiryListDto, ReplyInquiryDto } from './dto/inquiry.dto.js';
import { InquiriesService } from './inquiries.service.js';

/** 문의함. 로그인한 사람은 문의를 보내고 내 문의와 답변을 볼 수 있고, 관리자는 모든 문의에 답변한다. */
@Controller('inquiries')
@UseGuards(SessionGuard)
export class InquiriesController {
  constructor(private readonly inquiries: InquiriesService) {}

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreateInquiryDto | undefined): Promise<InquiryDto> {
    return this.inquiries.create(req.user, body);
  }

  @Get('mine')
  mine(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<InquiryListDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.inquiries.mine(req.user);
  }

  // 아래 관리자 라우트는 ':id' 보다 먼저 선언해 'admin' 이 id 로 읽히지 않게 한다.
  @Get('admin')
  @UseGuards(AdminGuard)
  listAll(@Query('status') status: string | undefined, @Res({ passthrough: true }) res: Response): Promise<InquiryListDto> {
    res.setHeader('Cache-Control', 'no-store');
    const s = status ?? 'open';
    if (s !== 'open' && s !== 'answered' && s !== 'all') throw new BadRequestException('status 는 open, answered, all 중 하나예요.');
    return this.inquiries.listAll(s);
  }

  @Post(':id/reply')
  @UseGuards(AdminGuard)
  reply(@Param('id') id: string, @Body() body: ReplyInquiryDto | undefined): Promise<InquiryDto> {
    return this.inquiries.reply(id, body);
  }
}

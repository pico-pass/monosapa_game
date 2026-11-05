import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard.js';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import type { CreateReportDto, MutedListDto, ReportDto, ReportListDto, ResolveReportDto, UnmuteDto } from './dto/reports.dto.js';
import { ReportsService } from './reports.service.js';

/** 신고. 로그인한 사람은 챗방·개인채팅 메시지와 프로필을 신고할 수 있고, 관리자는 신고를 처리한다. */
@Controller('reports')
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @HttpCode(204)
  create(@Req() req: AuthedRequest, @Body() body: CreateReportDto | undefined): Promise<void> {
    return this.reports.create(req.user, body);
  }

  // 아래 관리자 라우트는 모두 AdminGuard 를 붙인다.
  @Get('admin')
  @UseGuards(AdminGuard)
  adminList(@Query('status') status: string | undefined, @Res({ passthrough: true }) res: Response): Promise<ReportListDto> {
    res.setHeader('Cache-Control', 'no-store');
    const s = status ?? 'open';
    if (s !== 'open' && s !== 'done' && s !== 'all') throw new BadRequestException('status 는 open, done, all 중 하나예요.');
    return this.reports.adminList(s);
  }

  @Get('admin/muted')
  @UseGuards(AdminGuard)
  muted(@Res({ passthrough: true }) res: Response): Promise<MutedListDto> {
    res.setHeader('Cache-Control', 'no-store');
    return this.reports.muted();
  }

  @Post('admin/unmute')
  @UseGuards(AdminGuard)
  @HttpCode(204)
  unmute(@Body() body: UnmuteDto | undefined): Promise<void> {
    return this.reports.unmute(String(body?.uid ?? ''));
  }

  @Post('admin/:id/resolve')
  @UseGuards(AdminGuard)
  resolve(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: ResolveReportDto | undefined): Promise<ReportDto> {
    return this.reports.resolve(req.user, id, body);
  }
}

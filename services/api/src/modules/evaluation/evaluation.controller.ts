import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type {
  AppUser,
  CreateShareLinkBody,
  CreateShareLinkResponse,
  OverrideScoreBody,
  PublicReportResponse,
  ReportDetailResponse,
  ReportListResponse,
} from '@zios/shared-types';
import { CurrentUser, Public, Roles } from '@/common/decorators';
import { EvaluationService } from './evaluation.service';
import { OverrideService } from './override.service';
import { ShareLinkService } from './share-link.service';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Controller('reports')
export class EvaluationController {
  constructor(
    private readonly evaluation: EvaluationService,
    private readonly overrides: OverrideService,
    private readonly shareLinks: ShareLinkService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AppUser,
    @Query('status') status: 'pending' | 'completed' | 'failed' | undefined,
    @Query('q') q: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ): Promise<ReportListResponse> {
    const pageNum = Math.max(1, Number(page ?? 1));
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize ?? DEFAULT_PAGE_SIZE)));
    const { items, total } = await this.evaluation.listForOrg(user.orgId, {
      status,
      q,
      page: pageNum,
      pageSize: size,
    });
    const totalPages = Math.ceil(total / size);
    return { reports: items, page: pageNum, pageSize: size, total, totalPages };
  }

  @Get(':sessionId')
  async getDetail(
    @CurrentUser() user: AppUser,
    @Param('sessionId') sessionId: string,
  ): Promise<ReportDetailResponse> {
    const detail = await this.evaluation.findDetail(user.orgId, sessionId);
    return {
      report: detail.report,
      scores: detail.scores,
      evidenceSpans: detail.evidenceSpans,
      overrides: detail.overrides,
      transcript: detail.transcript,
    };
  }

  @Roles('admin')
  @Post(':sessionId/scores/:scoreId/override')
  @HttpCode(201)
  async overrideScore(
    @CurrentUser() user: AppUser,
    @Param('sessionId') sessionId: string,
    @Param('scoreId') scoreId: string,
    @Body() body: OverrideScoreBody,
  ): Promise<{ override: import('@zios/shared-types').ScoreOverride }> {
    const detail = await this.evaluation.findDetail(user.orgId, sessionId);
    const override = await this.overrides.override(
      user.orgId,
      detail.report.id,
      scoreId,
      body.newScore,
      body.reasonCode,
      body.reasonText,
      user.id,
    );
    return { override };
  }

  @Roles('admin')
  @Post(':sessionId/share')
  @HttpCode(201)
  async createShareLink(
    @CurrentUser() user: AppUser,
    @Param('sessionId') sessionId: string,
    @Body() body: CreateShareLinkBody,
  ): Promise<CreateShareLinkResponse> {
    const detail = await this.evaluation.findDetail(user.orgId, sessionId);
    const { link, token } = await this.shareLinks.create(
      user.orgId,
      detail.report.id,
      body.expiresInHours,
    );
    return { link: { ...link, token } };
  }

  @Public()
  @Get('share/:token')
  async viewShared(@Param('token') token: string): Promise<PublicReportResponse> {
    const { reportId } = await this.shareLinks.resolve(token);
    const detail = await this.evaluation.findDetailByReportId(reportId);
    return {
      report: detail.report,
      scores: detail.scores,
      evidenceSpans: detail.evidenceSpans,
      transcript: detail.transcript,
    };
  }
}

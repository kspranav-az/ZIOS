import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AppUser } from '@zios/shared-types';
import { CurrentUser, Roles } from '@/common/decorators';
import {
  AnalysisService,
  type AnalysisJobSummary,
  type QuestionFeaturesResult,
  type SessionAnalysisResult,
} from './analysis.service';

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  /**
   * Admin-only redrive of a DLQ'd analysis job: resets the job to pending and
   * re-enqueues it. Replaces the manual `scripts/redrive-analysis-job.js`.
   */
  @Post('dlq/:jobId/redrive')
  @HttpCode(200)
  @Roles('admin')
  async redriveDlq(
    @CurrentUser() user: AppUser,
    @Param('jobId') jobId: string,
  ): Promise<AnalysisJobSummary> {
    return this.analysis.redrive(user.orgId, jobId);
  }

  @Get('sessions/:sessionId')
  async getSessionAnalysis(
    @CurrentUser() user: AppUser,
    @Param('sessionId') sessionId: string,
  ): Promise<SessionAnalysisResult> {
    return this.analysis.getSessionAnalysis(user.orgId, sessionId);
  }

  @Get('sessions/:sessionId/questions/:questionId/features')
  async getQuestionFeatures(
    @CurrentUser() user: AppUser,
    @Param('sessionId') sessionId: string,
    @Param('questionId') questionId: string,
  ): Promise<QuestionFeaturesResult> {
    return this.analysis.getQuestionFeatures(user.orgId, sessionId, questionId);
  }
}

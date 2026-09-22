import { Controller, Get, Param } from '@nestjs/common';
import type { AppUser } from '@zios/shared-types';
import { CurrentUser } from '@/common/decorators';
import {
  AnalysisService,
  type QuestionFeaturesResult,
  type SessionAnalysisResult,
} from './analysis.service';

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

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

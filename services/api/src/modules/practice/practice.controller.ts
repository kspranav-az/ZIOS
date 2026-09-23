import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  CandidateProgressResponse,
  CandidateReadinessResponse,
  PracticeConsentBody,
  PracticeCreateBody,
  PracticeCreateResponse,
  PracticeFromJdBody,
  PracticeLibraryPack,
  PracticePreflightResponse,
  PracticeReportDetailResponse,
  PracticeSessionDetailResponse,
  PracticeTurnBody,
  PracticeTurnResponse,
} from '@zios/shared-types';
import { Public } from '@/common/decorators';
import {
  CandidateAuthGuard,
  CurrentCandidate,
  type CandidateAuthContext,
} from '@/modules/candidate-accounts';
import { ResumeService } from '@/modules/resume';
import { PRACTICE_CONSENT_TEXT, PRACTICE_CONSENT_TEXT_VERSION } from './consent-text';
import { PRACTICE_LIBRARY_PACKS } from './library';
import { PracticeEvaluationService } from './practice-evaluation.service';
import { PracticeService } from './practice.service';

/**
 * Practice engine routes (Phase 12, D5). @Public + CandidateAuthGuard like
 * all /cand/* routes: employer tokens get 403 before any handler runs, so
 * no employer-tenant read path can ever touch practice tables.
 */
@Public()
@UseGuards(CandidateAuthGuard)
@Controller('cand/practice')
export class PracticeController {
  constructor(
    private readonly practice: PracticeService,
    private readonly evaluation: PracticeEvaluationService,
    private readonly resumes: ResumeService,
  ) {}

  @Get('library')
  library(): { packs: PracticeLibraryPack[]; consent: { version: string; text: string } } {
    return { packs: PRACTICE_LIBRARY_PACKS, consent: { version: PRACTICE_CONSENT_TEXT_VERSION, text: PRACTICE_CONSENT_TEXT } };
  }

  @Post()
  async create(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Body() body: PracticeCreateBody,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<PracticeCreateResponse> {
    const { session, recoveryToken } = await this.practice.create(auth.account.id, body, {
      ip,
      userAgent,
    });
    return { session, recoveryToken };
  }

  /** JD-targeted mock (D10): generates the question set, then creates the session. */
  @Post('from-jd')
  async createFromJd(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Body() body: PracticeFromJdBody,
  ): Promise<PracticeCreateResponse> {
    const resumeText = await this.resumes.resumeTextFor(auth.account.id);
    const { session, recoveryToken } = await this.practice.createFromJd(auth.account.id, {
      jdText: body?.jdText ?? '',
      mode: body?.mode ?? 'text',
      resumeText,
    });
    return { session, recoveryToken };
  }

  /** Practice history + pace/filler trend series + streak (D14). */
  @Get('progress')
  async progress(@CurrentCandidate() auth: CandidateAuthContext): Promise<CandidateProgressResponse> {
    return this.evaluation.getProgress(auth.account.id);
  }

  /** Readiness score with formula-versioned component breakdown (D15). */
  @Get('readiness')
  async readiness(@CurrentCandidate() auth: CandidateAuthContext): Promise<CandidateReadinessResponse> {
    return this.evaluation.getReadiness(auth.account.id);
  }

  @Get(':id')
  async detail(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Param('id') id: string,
  ): Promise<PracticeSessionDetailResponse> {
    return this.practice.detail(auth.account.id, id);
  }

  @Post(':id/consent')
  async consent(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Param('id') id: string,
    @Body() body: PracticeConsentBody,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<{ session: unknown }> {
    return this.practice.consent(auth.account.id, id, body, { ip, userAgent });
  }

  @Post(':id/preflight')
  @HttpCode(200)
  async preflight(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Param('id') id: string,
    @Headers('x-recovery-token') recoveryToken: string,
  ): Promise<PracticePreflightResponse> {
    return this.practice.preflight(auth.account.id, id, recoveryToken ?? '');
  }

  @Post(':id/turn')
  @HttpCode(200)
  async turn(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Param('id') id: string,
    @Headers('x-recovery-token') recoveryToken: string,
    @Body() body: PracticeTurnBody,
  ): Promise<PracticeTurnResponse> {
    return this.practice.turn(auth.account.id, id, recoveryToken ?? '', body ?? {});
  }

  @Post(':id/abandon')
  async abandon(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Param('id') id: string,
    @Headers('x-recovery-token') recoveryToken: string,
  ) {
    return this.practice.abandon(auth.account.id, id, recoveryToken ?? '');
  }

  @Post(':id/recover')
  async recover(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Param('id') id: string,
    @Headers('x-recovery-token') recoveryToken: string,
  ) {
    return this.practice.recover(auth.account.id, id, recoveryToken ?? '');
  }

  @Get(':id/report')
  async report(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Param('id') id: string,
  ): Promise<PracticeReportDetailResponse> {
    const detail = await this.evaluation.findDetail(auth.account.id, id);
    if (!detail) {
      return { report: null, scores: [], evidenceSpans: [], transcript: [], coachingTips: [] };
    }
    return detail;
  }
}

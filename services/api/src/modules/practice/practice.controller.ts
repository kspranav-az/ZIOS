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
  PracticeExtractJdBody,
  PracticeExtractJdResponse,
  PracticeFromJdBody,
  PracticeLibraryPack,
  PracticeLiveTokenResponse,
  PracticePreflightResponse,
  PracticeReportDetailResponse,
  PracticeSessionDetailResponse,
  PracticeTurnAudioBody,
  PracticeTurnAudioResponse,
  PracticeTurnBody,
  PracticeTurnResponse,
} from '@zios/shared-types';
import { Public } from '@/common/decorators';
import { ApiException } from '@/common/errors';
import {
  CandidateAuthGuard,
  CurrentCandidate,
  type CandidateAuthContext,
} from '@/modules/candidate-accounts';
import { DocumentExtractionClient, ResumeService, looksLikePlainText } from '@/modules/resume';
import { PRACTICE_CONSENT_TEXT, PRACTICE_CONSENT_TEXT_VERSION } from './consent-text';
import { PRACTICE_LIBRARY_PACKS } from './library';
import { PracticeAudioService } from './practice-audio.service';
import { PracticeEvaluationService } from './practice-evaluation.service';
import { PracticeService } from './practice.service';

/** Same ceiling as resume upload — JDs are text documents, not media. */
const MAX_JD_BYTES = 1_000_000;

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
    private readonly audio: PracticeAudioService,
    private readonly extraction: DocumentExtractionClient,
  ) {}

  @Get('library')
  library(): { packs: PracticeLibraryPack[]; consent: { version: string; text: string } } {
    return {
      packs: PRACTICE_LIBRARY_PACKS,
      consent: { version: PRACTICE_CONSENT_TEXT_VERSION, text: PRACTICE_CONSENT_TEXT },
    };
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

  /**
   * JD file upload for practice setup (D6): extract plain text from a
   * .pdf/.txt JD so the candidate can review/edit it before starting a
   * JD-targeted mock. Reuses the resume extraction port — no new capability.
   * Nothing is stored; the text goes straight back to the client.
   */
  @Post('extract-jd')
  @HttpCode(200)
  async extractJd(@Body() body: PracticeExtractJdBody): Promise<PracticeExtractJdResponse> {
    const fileName =
      typeof body?.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : null;
    if (!fileName) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'fileName is required');
    }
    const lower = fileName.toLowerCase();
    const isPdf = lower.endsWith('.pdf');
    const isTxt = lower.endsWith('.txt');
    if (!isPdf && !isTxt) {
      throw new ApiException(
        400,
        'VALIDATION_ERROR',
        'unsupported file type — upload a .txt or .pdf JD',
      );
    }
    if (typeof body?.contentBase64 !== 'string' || body.contentBase64.length === 0) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'contentBase64 is required');
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(body.contentBase64, 'base64');
    } catch {
      throw new ApiException(400, 'VALIDATION_ERROR', 'contentBase64 is not valid base64');
    }
    if (buffer.length === 0 || buffer.length > MAX_JD_BYTES) {
      throw new ApiException(413, 'JD_TOO_LARGE', 'JD must be between 1 byte and 1 MB');
    }

    if (isTxt) {
      if (!looksLikePlainText(buffer)) {
        throw new ApiException(
          422,
          'TEXT_REQUIRED',
          'unsupported file type — upload a .txt or .pdf JD, or paste the plain text',
        );
      }
      return { text: buffer.toString('utf8') };
    }
    try {
      const { text } = await this.extraction.extract(body.contentBase64, 'application/pdf');
      return { text };
    } catch (cause) {
      if (cause instanceof ApiException && cause.getStatus() === 502) {
        throw new ApiException(
          422,
          'TEXT_REQUIRED',
          'could not extract text from this PDF — it may be corrupt or a scanned image. Paste the plain text instead.',
        );
      }
      throw cause;
    }
  }

  /** Practice history + pace/filler trend series + streak (D14). */
  @Get('progress')
  async progress(
    @CurrentCandidate() auth: CandidateAuthContext,
  ): Promise<CandidateProgressResponse> {
    return this.evaluation.getProgress(auth.account.id);
  }

  /** Readiness score with formula-versioned component breakdown (D15). */
  @Get('readiness')
  async readiness(
    @CurrentCandidate() auth: CandidateAuthContext,
  ): Promise<CandidateReadinessResponse> {
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

  /**
   * Voice-practice audio turn (Phase 12b): store the recording, transcribe it
   * via the orchestrator, return the transcript. The client submits the
   * transcript through POST :id/turn (optionally with the recordingRef).
   */
  @Post(':id/turn-audio')
  @HttpCode(200)
  async turnAudio(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Param('id') id: string,
    @Headers('x-recovery-token') recoveryToken: string,
    @Body() body: PracticeTurnAudioBody,
  ): Promise<PracticeTurnAudioResponse> {
    return this.audio.transcribeTurn(auth.account.id, id, recoveryToken ?? '', body);
  }

  /**
   * Live practice token (Phase 12e): LiveKit room + orchestrator WS for a
   * 'live'-mode session that already went through preflight. The recovery
   * token is forwarded to the orchestrator for its conductor calls.
   */
  @Post(':id/live/token')
  async liveToken(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Param('id') id: string,
    @Headers('x-recovery-token') recoveryToken: string,
  ): Promise<PracticeLiveTokenResponse> {
    return this.practice.issueLiveToken(auth.account.id, id, recoveryToken ?? '');
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

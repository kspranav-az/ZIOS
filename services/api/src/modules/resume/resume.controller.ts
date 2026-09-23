import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type {
  CandidateResumeResponse,
  ResumeJdMatchBody,
  ResumeJdMatchResponse,
  ResumeUploadBody,
} from '@zios/shared-types';
import { Public } from '@/common/decorators';
import {
  CandidateAuthGuard,
  CurrentCandidate,
  type CandidateAuthContext,
} from '@/modules/candidate-accounts';
import type { CandidateResumeRecord } from './candidate-resume.repository';
import { ResumeService } from './resume.service';

function toResponse(row: CandidateResumeRecord): CandidateResumeResponse {
  return {
    id: row.id,
    fileName: row.fileName,
    parsed: row.parsed as CandidateResumeResponse['parsed'],
    atsReport: row.atsReport as CandidateResumeResponse['atsReport'],
    updatedAt: row.updatedAt,
  };
}

/**
 * Candidate resume routes (Phase 12, D10). Same guard posture as all /cand/*
 * routes: employer tokens get 403 before any handler runs, so no
 * employer-tenant read path can touch candidate resumes.
 */
@Public()
@UseGuards(CandidateAuthGuard)
@Controller('cand/resume')
export class ResumeController {
  constructor(private readonly resumes: ResumeService) {}

  @Post()
  async upload(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Body() body: ResumeUploadBody,
  ): Promise<CandidateResumeResponse> {
    return toResponse(await this.resumes.upload(auth.account.id, body ?? {}));
  }

  @Get()
  async get(@CurrentCandidate() auth: CandidateAuthContext): Promise<CandidateResumeResponse> {
    return toResponse(await this.resumes.get(auth.account.id));
  }

  @Delete()
  async erase(@CurrentCandidate() auth: CandidateAuthContext): Promise<{ ok: true }> {
    await this.resumes.erase(auth.account.id);
    return { ok: true };
  }

  @Post('match')
  @HttpCode(200)
  async match(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Body() body: ResumeJdMatchBody,
  ): Promise<ResumeJdMatchResponse> {
    return this.resumes.matchAgainstJd(auth.account.id, body?.jdText ?? '');
  }
}

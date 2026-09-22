import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import type {
  CandidateAuthResponse,
  CandidateMePatchBody,
  CandidateMeResponse,
  CandOtpRequestBody,
  CandOtpRequestResponse,
  CandOtpVerifyBody,
} from '@zios/shared-types';
import { Public } from '@/common/decorators';
import { CandidateAccountsService } from './candidate-accounts.service';
import { CandidateAuthGuard, CurrentCandidate, type CandidateAuthContext } from './candidate-auth.guard';

/**
 * Candidate auth (Phase 12, D7/D8). @Public() like /v1: the global session
 * guards skip these routes; CandidateAuthGuard enforces candidate-audience
 * auth locally on the protected ones. The SPA holds the bearer token in
 * sessionStorage (no cookie — third-party contexts don't need it).
 */
@Controller('cand')
export class CandidateAccountsController {
  constructor(private readonly candidates: CandidateAccountsService) {}

  @Public()
  @Post('auth/otp/request')
  @HttpCode(200)
  requestOtp(@Body() body: CandOtpRequestBody): Promise<CandOtpRequestResponse> {
    return this.candidates.requestOtp(body?.email);
  }

  @Public()
  @Post('auth/otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() body: CandOtpVerifyBody): Promise<CandidateAuthResponse> {
    return this.candidates.verifyOtp(body?.email, body?.code);
  }

  @Public()
  @UseGuards(CandidateAuthGuard)
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@CurrentCandidate() auth: CandidateAuthContext): Promise<void> {
    await this.candidates.logout(auth.session.id);
  }

  @Public()
  @UseGuards(CandidateAuthGuard)
  @Get('me')
  async me(@CurrentCandidate() auth: CandidateAuthContext): Promise<CandidateMeResponse> {
    return this.candidates.getMe(auth.account.id);
  }

  @Public()
  @UseGuards(CandidateAuthGuard)
  @Patch('me')
  async patchMe(
    @CurrentCandidate() auth: CandidateAuthContext,
    @Body() body: CandidateMePatchBody,
  ): Promise<CandidateMeResponse> {
    return this.candidates.patchMe(auth.account.id, body ?? {});
  }
}

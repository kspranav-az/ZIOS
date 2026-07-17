import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  AppUser,
  BulkInviteResponse,
  CandidateOtpVerifyBody,
  CandidateOtpVerifyResponse,
  ConsentByTokenBody,
  ConsentByTokenResponse,
  CreateCandidateInviteBody,
  CreateCandidateInviteResponse,
  Invite,
  InviteDetailResponse,
  InviteListResponse,
  ReissueInviteBody,
  RescheduleInviteBody,
  TokenResolveResponse,
} from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { CurrentUser, Public, Roles } from '@/common/decorators';
import { DatabaseService } from '@/modules/database';
import { ConsentService } from '@/modules/consent';
import { SessionsService } from '@/modules/sessions';
import { CandidateOtpService } from './candidate-otp.service';
import { InvitesService } from './invites.service';
import { RemindersService } from './reminders.service';

@Controller('invites')
export class InvitesController {
  constructor(
    private readonly service: InvitesService,
    private readonly sessions: SessionsService,
    private readonly consent: ConsentService,
    private readonly otp: CandidateOtpService,
    private readonly reminders: RemindersService,
    private readonly db: DatabaseService,
  ) {}

  /* ---- employer-facing (auth required) ---- */

  @Post()
  async create(
    @CurrentUser() user: AppUser,
    @Body() body: CreateCandidateInviteBody,
  ): Promise<CreateCandidateInviteResponse> {
    return this.service.create(user.orgId, body);
  }

  @Post('bulk')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async bulk(
    @CurrentUser() user: AppUser,
    @Query('kitVersionId') kitVersionId: string | undefined,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<BulkInviteResponse> {
    if (!kitVersionId) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'kitVersionId query parameter is required');
    }
    if (!file) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'CSV file is required');
    }
    return this.service.bulkCreateWithKitVersionId(user.orgId, kitVersionId, file.buffer);
  }

  @Get()
  async list(@CurrentUser() user: AppUser): Promise<InviteListResponse> {
    return { invites: await this.service.list(user.orgId) };
  }

  @Get(':id')
  async getDetail(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<InviteDetailResponse> {
    return this.service.getDetail(user.orgId, id);
  }

  @Post(':id/reissue')
  async reissue(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: ReissueInviteBody,
  ): Promise<CreateCandidateInviteResponse> {
    return this.service.reissue(user.orgId, id, body);
  }

  @Post(':id/reschedule')
  async reschedule(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: RescheduleInviteBody,
  ): Promise<{ invite: Invite }> {
    const invite = await this.service.reschedule(user.orgId, id, body);
    return { invite };
  }

  @Post('-/reminders/run')
  @Roles('admin')
  @HttpCode(200)
  async runReminders(): Promise<{ sent: number }> {
    return this.db.transaction((q) => this.reminders.sendDueReminders(q));
  }

  /* ---- public candidate-facing ---- */

  @Public()
  @Get('by-token/:token')
  async resolveToken(@Param('token') token: string): Promise<TokenResolveResponse> {
    const resolved = await this.service.resolveByToken(token);
    const [session, consent] = await Promise.all([
      this.sessions.findByInviteId(resolved.invite.id),
      this.consent.findByInviteId(resolved.invite.id),
    ]);
    return { ...resolved, session, consent };
  }

  @Public()
  @Post('by-token/:token/otp/request')
  @HttpCode(200)
  async requestOtp(@Param('token') token: string): Promise<{ ok: true; expiresInSeconds: number }> {
    const resolved = await this.service.resolveByToken(token);
    if (!resolved.invite.otpRequired) {
      return { ok: true, expiresInSeconds: 0 };
    }
    const result = await this.db.transaction((q) =>
      this.otp.requestOtp(resolved.invite.id, resolved.candidate.email, q),
    );
    return { ok: true, expiresInSeconds: result.expiresInSeconds };
  }

  @Public()
  @Post('by-token/:token/otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Param('token') token: string,
    @Body() body: CandidateOtpVerifyBody,
  ): Promise<CandidateOtpVerifyResponse> {
    const resolved = await this.service.resolveByToken(token);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const ok = await this.db.transaction((q) => this.otp.verifyOtp(resolved.invite.id, code, q));
    if (!ok) {
      throw new ApiException(400, 'OTP_INVALID', 'OTP is invalid or expired');
    }
    await this.db.transaction((q) => this.service.markOtpVerified(resolved.invite.id, q));
    return { verified: true };
  }

  @Public()
  @Post('by-token/:token/consent')
  @HttpCode(200)
  async consentByToken(
    @Param('token') token: string,
    @Body() body: ConsentByTokenBody,
  ): Promise<ConsentByTokenResponse> {
    return this.sessions.recordConsentByToken(token, body);
  }

  @Public()
  @Get('unsubscribe')
  async unsubscribe(
    @Query('email') email: string | undefined,
    @Query('token') token: string | undefined,
  ): Promise<{ unsubscribed: true }> {
    if (!email || !token) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'email and token are required');
    }
    if (!RemindersService.verifyUnsubscribeToken(email, token)) {
      throw new ApiException(400, 'TOKEN_INVALID', 'unsubscribe token invalid');
    }
    await this.db.query(
      'INSERT INTO email_opt_out (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET unsubscribed_at = now()',
      [email.toLowerCase()],
    );
    return { unsubscribed: true };
  }
}

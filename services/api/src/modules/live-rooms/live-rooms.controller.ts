import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type {
  AppUser,
  CockpitStateResponse,
  LiveEndResponse,
  LiveTokenResponse,
  MarkCoverageBody,
  RescheduleRequestBody,
  RescheduleRequestResponse,
  ScheduleSlotBody,
  ScheduleSlotResponse,
} from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { CurrentUser, Public } from '@/common/decorators';
import { TokenService } from '@/common/tokens';
import { CandidatesRepository } from '@/modules/candidates';
import { InvitesRepository } from '@/modules/invites';
import { LiveRoomsService } from './live-rooms.service';

function recoveryToken(header: string | undefined): string {
  if (!header) {
    throw new ApiException(401, 'RECOVERY_TOKEN_MISSING', 'X-Recovery-Token header is required');
  }
  return header.trim();
}

@Controller()
export class LiveRoomsController {
  constructor(
    private readonly service: LiveRoomsService,
    private readonly invites: InvitesRepository,
    private readonly candidates: CandidatesRepository,
  ) {}

  /* ---- scheduling ---- */

  @Post('invites/:id/schedule')
  @HttpCode(200)
  async schedule(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: ScheduleSlotBody,
  ): Promise<ScheduleSlotResponse> {
    return this.service.schedule(user.orgId, id, body);
  }

  @Get('invites/:id/schedule')
  async getSchedule(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<{ slot: import('@zios/shared-types').InterviewSlot | null }> {
    return this.service.getSchedule(id, user.orgId);
  }

  @Post('invites/:id/reschedule/confirm')
  @HttpCode(200)
  async confirmReschedule(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: { newSlotAt: string },
  ): Promise<ScheduleSlotResponse> {
    return this.service.confirmReschedule(user.orgId, id, body.newSlotAt);
  }

  @Public()
  @Post('invites/by-token/:token/reschedule-request')
  @HttpCode(200)
  async requestReschedule(
    @Param('token') token: string,
    @Body() body: RescheduleRequestBody,
  ): Promise<RescheduleRequestResponse> {
    const invite = await this.invites.findByTokenHash(TokenService.hash(token));
    if (!invite) {
      throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
    }
    return this.service.requestReschedule(invite.id, body);
  }

  @Get('invites/:id/ics')
  async downloadIcs(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { slot } = await this.service.getSchedule(id, user.orgId);
    if (!slot) {
      throw new ApiException(404, 'SLOT_NOT_FOUND', 'slot not found');
    }
    const invite = await this.invites.findById(user.orgId, id);
    if (!invite) {
      throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
    }
    const candidate = await this.candidates.findById(user.orgId, invite.candidateId);
    if (!candidate) {
      throw new ApiException(404, 'CANDIDATE_NOT_FOUND', 'candidate not found');
    }
    const ics = this.service.generateIcs(slot, candidate.email, candidate.name);
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="interview-${slot.id}.ics"`);
    return ics;
  }

  /* ---- room tokens ---- */

  @Public()
  @Post('sessions/:id/live/token')
  @HttpCode(200)
  async issueCandidateToken(
    @Param('id') id: string,
    @Headers('x-recovery-token') recovery: string | undefined,
  ): Promise<LiveTokenResponse> {
    return this.service.issueCandidateToken(id, recoveryToken(recovery));
  }

  @Post('sessions/:id/live/interviewer-token')
  @HttpCode(200)
  async issueInterviewerToken(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<LiveTokenResponse> {
    return this.service.issueInterviewerToken(id, user);
  }

  /* ---- cockpit ---- */

  @Get('sessions/:id/live/cockpit')
  async getCockpit(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
  ): Promise<CockpitStateResponse> {
    return this.service.getCockpitState(id, user);
  }

  @Post('sessions/:id/live/coverage')
  @HttpCode(200)
  async markCoverage(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Body() body: MarkCoverageBody,
  ): Promise<{ coverage: import('@zios/shared-types').SessionCoverage[] }> {
    return this.service.markCoverage(id, user, body);
  }

  @Post('sessions/:id/live/end')
  @HttpCode(200)
  async endCall(@CurrentUser() user: AppUser, @Param('id') id: string): Promise<LiveEndResponse> {
    return this.service.endCall(id, user);
  }
}

import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import type {
  AppUser,
  InterviewSession,
  PreflightBody,
  PreflightResponse,
  SessionDetailResponse,
  TurnBody,
  TurnResponse,
} from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { CurrentUser, Public } from '@/common/decorators';
import { SessionsService } from './sessions.service';

function recoveryToken(header: string | undefined): string {
  if (!header) {
    throw new ApiException(401, 'RECOVERY_TOKEN_MISSING', 'X-Recovery-Token header is required');
  }
  return header.trim();
}

@Controller('sessions')
export class SessionsController {
  constructor(private readonly service: SessionsService) {}

  @Public()
  @Post(':id/preflight')
  @HttpCode(200)
  async preflight(
    @Param('id') id: string,
    @Headers('x-recovery-token') recovery: string | undefined,
    @Body() body: PreflightBody,
  ): Promise<PreflightResponse> {
    return this.service.preflight(id, recoveryToken(recovery), body);
  }

  @Public()
  @Post(':id/turn')
  @HttpCode(200)
  async turn(
    @Param('id') id: string,
    @Headers('x-recovery-token') recovery: string | undefined,
    @Body() body: TurnBody,
  ): Promise<TurnResponse> {
    return this.service.turn(id, recoveryToken(recovery), body);
  }

  @Public()
  @Post(':id/abandon')
  @HttpCode(200)
  async abandon(
    @Param('id') id: string,
    @Headers('x-recovery-token') recovery: string | undefined,
  ): Promise<InterviewSession> {
    return this.service.abandon(id, recoveryToken(recovery));
  }

  @Public()
  @Post(':id/recover')
  @HttpCode(200)
  async recover(
    @Param('id') id: string,
    @Headers('x-recovery-token') recovery: string | undefined,
  ): Promise<{ session: InterviewSession; recoveryToken: string }> {
    const result = await this.service.recover(id, recoveryToken(recovery));
    return { session: result.session, recoveryToken: result.recoveryToken };
  }

  @Get(':id')
  async getDetail(
    @CurrentUser() _user: AppUser,
    @Param('id') id: string,
  ): Promise<SessionDetailResponse> {
    return this.service.getDetail(id);
  }
}

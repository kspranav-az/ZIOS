import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '@/common/decorators';
import { TenantContext } from '@/modules/database';
import {
  CurrentApiKey,
  ApiKeyGuard,
  Scopes,
  type ApiKeyAuth,
} from './api-key-auth.guard';
import {
  V1InterviewsService,
  type V1CreateInterviewBody,
  type V1InterviewCreated,
  type V1InterviewStatus,
  type V1Scorecard,
} from './v1-interviews.service';

/**
 * Partner Integration API v1 (FR-E13-2/3). Authenticated by org-scoped API
 * keys (ApiKeyGuard), NOT sessions — controllers are @Public() so the global
 * session AuthGuard stays out, and the guard + TenantContext.run provide the
 * org identity instead.
 */
@Public()
@UseGuards(ApiKeyGuard)
@Controller('v1/interviews')
export class InterviewsController {
  constructor(private readonly interviews: V1InterviewsService) {}

  @Post()
  @HttpCode(201)
  @Scopes('interviews:write')
  create(
    @CurrentApiKey() auth: ApiKeyAuth,
    @Body() body: V1CreateInterviewBody,
  ): Promise<V1InterviewCreated> {
    return this.asTenant(auth, () => this.interviews.create(auth, body));
  }

  @Get(':id')
  @Scopes('interviews:read')
  getStatus(
    @CurrentApiKey() auth: ApiKeyAuth,
    @Param('id') id: string,
  ): Promise<V1InterviewStatus> {
    return this.asTenant(auth, () => this.interviews.getStatus(auth, id));
  }

  @Get(':id/scorecard')
  @Scopes('interviews:read')
  getScorecard(
    @CurrentApiKey() auth: ApiKeyAuth,
    @Param('id') id: string,
  ): Promise<V1Scorecard> {
    return this.asTenant(auth, () => this.interviews.getScorecard(auth, id));
  }

  /**
   * Downstream services (kits/generation) use TenantContext (fail closed).
   * API keys carry no app_user, so the key acts with org-level powers — the
   * @Scopes check on each route is the authorization boundary.
   */
  private asTenant<T>(auth: ApiKeyAuth, fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ orgId: auth.orgId, userId: auth.keyId, role: 'admin' }, fn);
  }
}

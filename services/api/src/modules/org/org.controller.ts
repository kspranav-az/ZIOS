import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type {
  AcceptInviteBody,
  AcceptInviteResponse,
  AppUser,
  CreateInviteBody,
  CreateInviteResponse,
  MembersResponse,
} from '@zios/shared-types';
import { CurrentUser, Roles } from '@/common/decorators';
import { InvitesService } from './invites.service';
import { OrgService } from './org.service';

/**
 * Org-surface routes. Every route resolves "current org" from the session —
 * never from client-supplied org ids. Role policy:
 *   POST /orgs/current/invites        admin
 *   POST /orgs/current/invites/accept any authenticated user
 *   GET  /orgs/current/members        admin
 */
@Controller('orgs/current')
export class OrgController {
  constructor(
    private readonly orgs: OrgService,
    private readonly invites: InvitesService,
  ) {}

  @Post('invites')
  @Roles('admin')
  async createInvite(
    @CurrentUser() user: AppUser,
    @Body() body: CreateInviteBody,
  ): Promise<CreateInviteResponse> {
    const invite = await this.invites.create(user.orgId, user, body);
    return { invite };
  }

  @Post('invites/accept')
  @HttpCode(200)
  acceptInvite(
    @CurrentUser() user: AppUser,
    @Body() body: AcceptInviteBody,
  ): Promise<AcceptInviteResponse> {
    return this.invites.accept(body?.token, user);
  }

  @Get('members')
  @Roles('admin')
  async listMembers(@CurrentUser() user: AppUser): Promise<MembersResponse> {
    return { members: await this.orgs.listMembers(user.orgId) };
  }
}

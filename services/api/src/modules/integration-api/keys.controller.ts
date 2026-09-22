import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  BadRequestException,
} from '@nestjs/common';
import type { AppUser } from '@zios/shared-types';
import { CurrentUser, Roles } from '@/common/decorators';
import { ApiKeysService, type ApiKeyPublicView, type CreatedApiKey } from './api-keys.service';
import type { ApiKeyKind } from './api-keys.repository';

export interface CreateApiKeyBody {
  kind?: ApiKeyKind;
  label?: string;
  scopes?: string[];
  rateLimitPerMin?: number;
}

export interface ApiKeyListResponse {
  keys: ApiKeyPublicView[];
}

function parseKind(raw: unknown): ApiKeyKind {
  if (raw === 'live') return 'live';
  if (raw === undefined || raw === null || raw === 'test') return 'test';
  throw new BadRequestException('kind must be "test" or "live"');
}

/**
 * Org-admin management of Integration API keys (FR-E13-1). Session-authed
 * like the rest of the employer UI; the keys themselves authenticate
 * partner calls on /v1/* via ApiKeyGuard.
 */
@Controller('integration-api/keys')
export class KeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Post()
  @Roles('admin')
  async create(
    @CurrentUser() user: AppUser,
    @Body() body: CreateApiKeyBody,
  ): Promise<CreatedApiKey> {
    return this.keys.create({
      orgId: user.orgId,
      kind: parseKind(body?.kind),
      label: body?.label ?? null,
      scopes: normalizeScopes(body?.scopes),
      rateLimitPerMin: normalizeRateLimit(body?.rateLimitPerMin),
      createdBy: user.id,
    });
  }

  @Get()
  async list(
    @CurrentUser() user: AppUser,
    @Query('kind') kind?: string,
  ): Promise<ApiKeyListResponse> {
    const keys = await this.keys.list(user.orgId);
    const filtered =
      kind === 'test' || kind === 'live' ? keys.filter((key) => key.kind === kind) : keys;
    return { keys: filtered };
  }

  @Post(':id/rotate')
  @HttpCode(200)
  @Roles('admin')
  async rotate(@CurrentUser() user: AppUser, @Param('id') id: string): Promise<CreatedApiKey> {
    return this.keys.rotate(user.orgId, id);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Roles('admin')
  async revoke(@CurrentUser() user: AppUser, @Param('id') id: string): Promise<ApiKeyPublicView> {
    return this.keys.revoke(user.orgId, id);
  }
}

function normalizeScopes(scopes: unknown): string[] | undefined {
  if (scopes === undefined || scopes === null) {
    return undefined;
  }
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
    throw new BadRequestException('scopes must be an array of strings');
  }
  return scopes as string[];
}

function normalizeRateLimit(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new BadRequestException('rateLimitPerMin must be an integer between 1 and 10000');
  }
  return limit;
}

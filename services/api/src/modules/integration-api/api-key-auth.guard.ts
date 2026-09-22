import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import IORedis from 'ioredis';
import { ApiException } from '@/common/errors';
import { REDIS_CLIENT } from '@/modules/queue';
import { hashApiKey, ApiKeysService } from './api-keys.service';
import type { ApiKeyKind } from './api-keys.repository';

/**
 * Resolved API key attached to the request by ApiKeyGuard. This is the
 * integration-API identity: no app_user exists for key-authenticated calls.
 */
export interface ApiKeyAuth {
  keyId: string;
  orgId: string;
  kind: ApiKeyKind;
  scopes: string[];
}

const authStore = new WeakMap<Request, ApiKeyAuth>();

export function setApiKeyAuth(req: Request, auth: ApiKeyAuth): void {
  authStore.set(req, auth);
}

export function getApiKeyAuth(req: Request): ApiKeyAuth | null {
  return authStore.get(req) ?? null;
}

/** Injects the API key identity resolved by ApiKeyGuard. */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKeyAuth => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = getApiKeyAuth(req);
    if (!auth) {
      throw new Error('@CurrentApiKey() used on a route without ApiKeyGuard');
    }
    return auth;
  },
);

export const SCOPES_KEY = 'zios:scopes';

/**
 * Declares the API scopes a route requires (e.g. @Scopes('interviews:read')).
 * Consumed by ApiKeyGuard; routes without it accept any authenticated key.
 */
export const Scopes = (...scopes: string[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(SCOPES_KEY, scopes);

/**
 * Authentication + authorization + rate limit for the partner Integration
 * API (`/v1/*`). Applied locally on v1 controllers (which are @Public() so
 * the session AuthGuard stays out of the way — partners have no session).
 *
 * - `Authorization: Bearer zios_test_…|zios_live_…` → sha256 → active key
 *   lookup; miss → 401 INVALID_API_KEY.
 * - @Scopes metadata must be a subset of the key's scopes → 403 FORBIDDEN_SCOPE.
 * - Fixed-window rate limit per key (Redis INCR, 60s window) → 429 RATE_LIMITED
 *   with Retry-After.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeysService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const raw = extractBearer(req);
    if (!raw || !raw.startsWith('zios_')) {
      throw new ApiException(401, 'INVALID_API_KEY', 'a valid API key is required');
    }

    const record = await this.keys.findActiveByHash(hashApiKey(raw));
    if (!record) {
      throw new ApiException(401, 'INVALID_API_KEY', 'a valid API key is required');
    }

    const requiredScopes =
      this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (requiredScopes.length > 0) {
      const missing = requiredScopes.filter((scope) => !record.scopes.includes(scope));
      if (missing.length > 0) {
        throw new ApiException(
          403,
          'FORBIDDEN_SCOPE',
          `key is missing required scope(s): ${missing.join(', ')}`,
        );
      }
    }

    await this.assertRateLimit(record.id, record.rateLimitPerMin);

    const auth: ApiKeyAuth = {
      keyId: record.id,
      orgId: record.orgId,
      kind: record.kind,
      scopes: record.scopes,
    };
    setApiKeyAuth(req, auth);
    return true;
  }

  /**
   * Fixed-window counter per key: `ratelimit:{keyId}:{unix-minute}`. The INCR
   * creates the key on first use; the expire is best-effort (a rare TTL loss
   * just means one stale window).
   */
  private async assertRateLimit(keyId: string, limitPerMin: number): Promise<void> {
    const window = Math.floor(Date.now() / 60_000);
    const redisKey = `ratelimit:${keyId}:${window}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, 90);
    }
    if (count > limitPerMin) {
      const ttl = await this.redis.ttl(redisKey);
      throw new ApiException(
        429,
        'RATE_LIMITED',
        `rate limit of ${limitPerMin} requests per minute exceeded`,
        { retryAfterSeconds: ttl > 0 ? ttl : 60 },
      );
    }
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

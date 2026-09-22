import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { ApiException } from '@/common/errors';
import { hashApiKey, type ApiKeysService } from './api-keys.service';
import type { ApiKeyRecord } from './api-keys.repository';
import { ApiKeyGuard, getApiKeyAuth, type ApiKeyAuth } from './api-key-auth.guard';

function fakeKey(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: randomUUID(),
    orgId: randomUUID(),
    kind: 'test',
    keyHash: hashApiKey(`zios_test_${randomUUID()}`),
    prefix: 'zios_test_xy',
    label: null,
    scopes: ['interviews:read', 'interviews:write'],
    rateLimitPerMin: 120,
    createdBy: randomUUID(),
    createdAt: new Date().toISOString(),
    rotatedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function buildGuard(options: {
  key?: ApiKeyRecord | null;
  scopes?: string[];
  limit?: number;
  count?: number;
}) {
  const keys = {
    findActiveByHash: vi.fn(async (hash: string) =>
      options.key && hash === options.key.keyHash ? options.key : null,
    ),
  } as unknown as ApiKeysService;
  const reflector = {
    getAllAndOverride: vi.fn(() => options.scopes ?? []),
  } as unknown as Reflector;
  const redis = {
    incr: vi.fn(async () => options.count ?? 1),
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async () => 60),
  };
  const guard = new ApiKeyGuard(reflector, keys, redis as never);
  return { guard, keys, redis };
}

function contextFor(authorization?: string): { ctx: never; req: Request } {
  const req = { headers: authorization ? { authorization } : {} } as unknown as Request;
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
  return { ctx, req };
}

describe('ApiKeyGuard', () => {
  it('authenticates a valid key and attaches the ApiKeyAuth context', async () => {
    const raw = `zios_test_${randomUUID()}`;
    const key = fakeKey({ keyHash: hashApiKey(raw) });
    const keys = {
      findActiveByHash: vi.fn(async (hash: string) => (hash === key.keyHash ? key : null)),
    } as unknown as ApiKeysService;
    const reflector = { getAllAndOverride: vi.fn(() => []) } as unknown as Reflector;
    const redis = { incr: vi.fn(async () => 1), expire: vi.fn(async () => 1) };
    const guard = new ApiKeyGuard(reflector, keys, redis as never);

    const { ctx, req } = contextFor(`Bearer ${raw}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const auth = getApiKeyAuth(req) as ApiKeyAuth;
    expect(auth.keyId).toBe(key.id);
    expect(auth.orgId).toBe(key.orgId);
    expect(auth.kind).toBe('test');
    expect(redis.incr).toHaveBeenCalledTimes(1);
  });

  it('rejects missing, malformed, and unknown keys with 401 INVALID_API_KEY', async () => {
    const { guard } = buildGuard({ key: null });

    await expectApiError(guard.canActivate(contextFor().ctx), 401, 'INVALID_API_KEY');
    await expectApiError(
      guard.canActivate(contextFor('Bearer session-token').ctx),
      401,
      'INVALID_API_KEY',
    );
    await expectApiError(
      guard.canActivate(contextFor('Bearer zios_test_nope').ctx),
      401,
      'INVALID_API_KEY',
    );
  });

  it('enforces @Scopes metadata with 403 FORBIDDEN_SCOPE', async () => {
    const raw = `zios_test_${randomUUID()}`;
    const key = fakeKey({ scopes: ['interviews:read'] });
    const keys = {
      findActiveByHash: vi.fn(async (hash: string) =>
        hash === hashApiKey(raw) ? { ...key, keyHash: hashApiKey(raw) } : null,
      ),
    } as unknown as ApiKeysService;
    const reflector = {
      getAllAndOverride: vi.fn(() => ['interviews:write']),
    } as unknown as Reflector;
    const redis = { incr: vi.fn(async () => 1), expire: vi.fn(async () => 1) };
    const guard = new ApiKeyGuard(reflector, keys, redis as never);

    await expectApiError(
      guard.canActivate(contextFor(`Bearer ${raw}`).ctx),
      403,
      'FORBIDDEN_SCOPE',
    );
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('answers 429 RATE_LIMITED with Retry-After when the window is exhausted', async () => {
    const raw = `zios_test_${randomUUID()}`;
    const key = fakeKey({ rateLimitPerMin: 2 });
    const keys = {
      findActiveByHash: vi.fn(async (hash: string) =>
        hash === hashApiKey(raw) ? { ...key, keyHash: hashApiKey(raw) } : null,
      ),
    } as unknown as ApiKeysService;
    const reflector = { getAllAndOverride: vi.fn(() => []) } as unknown as Reflector;
    const redis = {
      incr: vi.fn(async () => 3),
      expire: vi.fn(async () => 1),
      ttl: vi.fn(async () => 42),
    };
    const guard = new ApiKeyGuard(reflector, keys, redis as never);

    await expectApiError(guard.canActivate(contextFor(`Bearer ${raw}`).ctx), 429, 'RATE_LIMITED');
  });
});

/**
 * ApiException carries the envelope ({ statusCode, code, message }) in
 * getResponse(), not as top-level properties — assert on the envelope.
 */
async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  try {
    await promise;
    expect.unreachable(`expected ApiException ${status} ${code}`);
  } catch (error) {
    const envelope = (error as ApiException).getResponse() as { statusCode: number; code: string };
    expect(envelope.statusCode).toBe(status);
    expect(envelope.code).toBe(code);
  }
}

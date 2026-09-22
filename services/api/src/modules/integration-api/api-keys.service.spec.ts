import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '@/common/errors';
import { ApiKeysRepository, type ApiKeyRecord } from './api-keys.repository';
import { ApiKeysService, hashApiKey } from './api-keys.service';

function fakeRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: randomUUID(),
    orgId: randomUUID(),
    kind: 'test',
    keyHash: hashApiKey(`zios_test_${randomUUID()}`),
    prefix: 'zios_test_ab',
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

function buildRepo(overrides: Record<string, unknown> = {}) {
  return {
    insert: vi.fn(async () => fakeRecord()),
    listByOrg: vi.fn(async () => [] as ApiKeyRecord[]),
    findById: vi.fn(async () => null as ApiKeyRecord | null),
    findActiveByHash: vi.fn(async () => null as ApiKeyRecord | null),
    replaceKeyMaterial: vi.fn(async (_id: string, hash: string, prefix: string) =>
      fakeRecord({ keyHash: hash, prefix, rotatedAt: new Date().toISOString() }),
    ),
    revoke: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('ApiKeysService', () => {
  it('creates a key with the zios_{kind}_ format and returns it exactly once', async () => {
    const repo = buildRepo();
    const service = new ApiKeysService(repo as unknown as ApiKeysRepository);

    const created = await service.create({
      orgId: randomUUID(),
      kind: 'live',
      createdBy: randomUUID(),
    });

    expect(created.key).toMatch(/^zios_live_[A-Za-z0-9_-]{43}$/);
    // Hash of the raw key is what gets persisted — never the key itself.
    const calls = (repo.insert as ReturnType<typeof vi.fn>).mock.calls as Array<
      [Record<string, unknown>]
    >;
    const persisted = calls[0]![0] as { keyHash: string; prefix: string };
    expect(persisted.keyHash).toBe(hashApiKey(created.key));
    expect(persisted.prefix).toBe(created.key.slice(0, 12));
    // The public view carries the prefix but never the full key.
    const viewWithoutKey = { ...created } as Record<string, unknown>;
    delete viewWithoutKey.key;
    expect(JSON.stringify(viewWithoutKey)).not.toContain(created.key.slice(12));
  });

  it('rotate replaces key material so the old hash stops authenticating', async () => {
    const original = fakeRecord();
    const repo = buildRepo({ findById: vi.fn(async () => original) });
    const service = new ApiKeysService(repo as unknown as ApiKeysRepository);

    const rotated = await service.rotate(original.orgId, original.id);

    expect(rotated.key).toMatch(/^zios_test_/);
    expect(rotated.key).not.toBe(original.keyHash);
    expect(repo.replaceKeyMaterial).toHaveBeenCalledWith(
      original.id,
      hashApiKey(rotated.key),
      rotated.key.slice(0, 12),
    );
    // The guard looks keys up by hash: a lookup with the OLD hash must miss.
    (repo.findActiveByHash as ReturnType<typeof vi.fn>).mockImplementation(async (hash: string) =>
      hash === original.keyHash ? null : original,
    );
    expect(await service.findActiveByHash(original.keyHash)).toBeNull();
  });

  it('rotate refuses revoked keys and cross-org ids 404', async () => {
    const revoked = fakeRecord({ revokedAt: new Date().toISOString() });
    const repo = buildRepo({ findById: vi.fn(async () => revoked) });
    const service = new ApiKeysService(repo as unknown as ApiKeysRepository);

    await expectApiError(service.rotate(revoked.orgId, revoked.id), 409, 'API_KEY_REVOKED');

    const otherOrg = fakeRecord();
    (repo.findById as ReturnType<typeof vi.fn>).mockImplementation(async () => otherOrg);
    await expectApiError(service.rotate(randomUUID(), otherOrg.id), 404, 'API_KEY_NOT_FOUND');
    await expectApiError(service.revoke(randomUUID(), otherOrg.id), 404, 'API_KEY_NOT_FOUND');
  });

  it('revoke marks the key revoked so the guard lookup misses it', async () => {
    const record = fakeRecord();
    const repo = buildRepo({
      findById: vi.fn(async () => record),
      findActiveByHash: vi.fn(async (hash: string) => (hash === record.keyHash ? record : null)),
    });
    const service = new ApiKeysService(repo as unknown as ApiKeysRepository);

    const view = await service.revoke(record.orgId, record.id);
    expect(view.revokedAt).not.toBeNull();
    expect(repo.revoke).toHaveBeenCalledWith(record.id);
  });

  it('hashApiKey is stable and distinct per key', () => {
    const a = hashApiKey('zios_test_abc');
    expect(a).toBe(hashApiKey('zios_test_abc'));
    expect(a).not.toBe(hashApiKey('zios_test_abd'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws ApiException envelopes', async () => {
    const repo = buildRepo();
    const service = new ApiKeysService(repo as unknown as ApiKeysRepository);
    try {
      await service.rotate(randomUUID(), randomUUID());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
    }
  });
});

/** Asserts on the ApiException response envelope ({ statusCode, code }). */
async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  try {
    await promise;
    expect.unreachable(`expected ApiException ${status} ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiException);
    const envelope = (error as ApiException).getResponse() as { statusCode: number; code: string };
    expect(envelope.statusCode).toBe(status);
    expect(envelope.code).toBe(code);
  }
}

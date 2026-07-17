import { describe, expect, it, vi } from 'vitest';
import type { AppUser, Kit, KitQuestion } from '@zios/shared-types';
import type { DatabaseService, Queryable } from '@/modules/database';
import type { KitsRepository, WriteOutcome } from './kits.repository';
import { KitsService } from './kits.service';
import type { QuestionsRepository } from './questions.repository';

const user: AppUser = {
  id: 'user-1',
  orgId: 'org-1',
  email: 'admin@acme.com',
  name: 'Admin',
  role: 'admin',
  createdAt: new Date().toISOString(),
};

function makeKit(overrides: Partial<Kit> = {}): Kit {
  return {
    id: 'kit-1',
    orgId: 'org-1',
    title: 'Backend Screen',
    role: 'Backend Engineer',
    level: 'mid',
    status: 'draft',
    settings: {
      mode: 'text',
      language: 'en',
      proctoringLevel: 'none',
      introText: null,
      outroText: null,
      logoUrl: null,
      totalTimeCapSec: 1800,
    },
    jdRef: null,
    jdGenerationId: null,
    generationMetadata: {},
    createdBy: user.id,
    createdAt: new Date().toISOString(),
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<KitQuestion> = {}): KitQuestion {
  return {
    id: 'q1',
    kitId: 'kit-1',
    topic: 'Behavioral',
    position: 'V',
    type: 'open_ended',
    prompt: 'Tell me about a time you shipped something hard.',
    options: null,
    difficulty: 'medium',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    followupFixed: null,
    followupDepthCap: null,
    rubricLines: [{ id: 'r1', text: 'Clarity', weight: 1 }],
    source: 'manual',
    sourceRef: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

interface MockRepos {
  kits: {
    findById: ReturnType<typeof vi.fn>;
    lockById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    listByOrg: ReturnType<typeof vi.fn>;
    maxVersion: ReturnType<typeof vi.fn>;
    insertVersion: ReturnType<typeof vi.fn>;
    listVersions: ReturnType<typeof vi.fn>;
    findVersion: ReturnType<typeof vi.fn>;
    touchUpdatedAt: ReturnType<typeof vi.fn>;
  };
  questions: { listByKit: ReturnType<typeof vi.fn> };
}

function makeService({ kit = makeKit(), questions = [makeQuestion()] } = {}) {
  const repos: MockRepos = {
    kits: {
      findById: vi.fn(async () => kit),
      lockById: vi.fn(async () => kit),
      update: vi.fn(async (): Promise<WriteOutcome<Kit>> => ({ kind: 'ok', value: kit })),
      insert: vi.fn(async () => kit),
      listByOrg: vi.fn(async () => [kit]),
      maxVersion: vi.fn(async () => 0),
      insertVersion: vi.fn(async (_input: unknown) => ({
        id: 'v1',
        kitId: kit.id,
        version: 1,
        publishedBy: user.id,
        publishedAt: new Date().toISOString(),
      })),
      listVersions: vi.fn(async () => []),
      findVersion: vi.fn(async () => null),
      touchUpdatedAt: vi.fn(async () => {}),
    },
    questions: {
      listByKit: vi.fn(async () => questions),
    },
  };
  const db = {
    withTenant: vi.fn(async (fn: (q: Queryable) => Promise<unknown>) => fn({} as Queryable)),
  };
  const service = new KitsService(
    db as unknown as DatabaseService,
    repos.kits as unknown as KitsRepository,
    repos.questions as unknown as QuestionsRepository,
  );
  return { service, repos };
}

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<Record<string, unknown>> {
  try {
    await promise;
  } catch (error) {
    const apiError = error as { getStatus?: () => number; getResponse?: () => unknown };
    expect(apiError.getStatus?.()).toBe(status);
    const body = apiError.getResponse?.() as Record<string, unknown>;
    expect(body.code).toBe(code);
    return body;
  }
  throw new Error(`expected ${status} ${code} but the call succeeded`);
}

describe('KitsService optimistic concurrency', () => {
  it('returns the updated kit when the expectedUpdatedAt matches', async () => {
    const { service, repos } = makeService();
    const kit = await service.update(user, 'kit-1', {
      title: 'New title',
      expectedUpdatedAt: '2026-07-17T00:00:00.000Z',
    });
    expect(kit.id).toBe('kit-1');
    expect(repos.kits.update).toHaveBeenCalledWith(
      'org-1',
      'kit-1',
      { title: 'New title' },
      '2026-07-17T00:00:00.000Z',
      expect.anything(),
    );
  });

  it('maps a stale write to 409 STALE_WRITE with the current updatedAt', async () => {
    const { service, repos } = makeService();
    repos.kits.update.mockResolvedValueOnce({ kind: 'stale', current: makeKit() });
    const body = await expectApiError(
      service.update(user, 'kit-1', { title: 'x', expectedUpdatedAt: 'old' }),
      409,
      'STALE_WRITE',
    );
    expect(body.currentUpdatedAt).toBe('2026-07-17T00:00:00.000Z');
  });

  it('maps a missing kit to 404 KIT_NOT_FOUND', async () => {
    const { service, repos } = makeService();
    repos.kits.findById.mockResolvedValueOnce(null);
    await expectApiError(service.update(user, 'nope', { title: 'x' }), 404, 'KIT_NOT_FOUND');
  });

  it('blocks edits on archived kits', async () => {
    const { service } = makeService({ kit: makeKit({ status: 'archived' }) });
    await expectApiError(service.update(user, 'kit-1', { title: 'x' }), 409, 'KIT_ARCHIVED');
  });
});

describe('KitsService.publish', () => {
  it('freezes version max+1 with a full snapshot and marks the kit published', async () => {
    const { service, repos } = makeService();
    repos.kits.maxVersion.mockResolvedValueOnce(2);
    const summary = await service.publish(user, 'kit-1');

    expect(repos.kits.lockById).toHaveBeenCalledWith('org-1', 'kit-1', expect.anything());
    const insertCall = repos.kits.insertVersion.mock.calls[0]?.[0] as {
      version: number;
      snapshot: { schemaVersion: number; questions: unknown[]; durationEstimateSec: number };
      publishedBy: string;
    };
    expect(insertCall.version).toBe(3);
    expect(insertCall.publishedBy).toBe(user.id);
    expect(insertCall.snapshot.schemaVersion).toBe(1);
    expect(insertCall.snapshot.questions).toHaveLength(1);
    // 120s limit × 1.2 overhead.
    expect(insertCall.snapshot.durationEstimateSec).toBe(144);
    expect(repos.kits.update).toHaveBeenCalledWith(
      'org-1',
      'kit-1',
      { status: 'published' },
      undefined,
      expect.anything(),
    );
    expect(summary.version).toBe(1); // mocked insertVersion return
  });

  it('rejects with 422 PUBLISH_VALIDATION_FAILED and details when validation fails', async () => {
    const { service } = makeService({ kit: makeKit({ role: null }), questions: [] });
    const body = await expectApiError(
      service.publish(user, 'kit-1'),
      422,
      'PUBLISH_VALIDATION_FAILED',
    );
    const details = body.details as string[];
    expect(details.some((d) => d.includes('role is required'))).toBe(true);
    expect(details.some((d) => d.includes('at least one question'))).toBe(true);
  });

  it('rejects publishing an archived kit', async () => {
    const { service } = makeService({ kit: makeKit({ status: 'archived' }) });
    await expectApiError(service.publish(user, 'kit-1'), 409, 'KIT_ARCHIVED');
  });

  it('rejects publishing a kit whose estimate exceeds the time cap', async () => {
    const kit = makeKit();
    kit.settings.totalTimeCapSec = 100;
    const { service } = makeService({ kit });
    const body = await expectApiError(
      service.publish(user, 'kit-1'),
      422,
      'PUBLISH_VALIDATION_FAILED',
    );
    expect((body.details as string[]).some((d) => d.includes('exceeds the kit time cap'))).toBe(
      true,
    );
  });
});

describe('KitsService version immutability', () => {
  it('the repository exposes no mutation path for kit_version rows', async () => {
    // kit-level updates are fine (the draft head is mutable); nothing may
    // mutate a frozen version. The DB trigger is the second line of defense
    // and is covered by the integration suite.
    const { KitsRepository } = await import('./kits.repository');
    const methods = Object.getOwnPropertyNames(KitsRepository.prototype);
    const versionMutators = methods.filter(
      (method) => /version/i.test(method) && /update|delete|remove|patch/i.test(method),
    );
    expect(versionMutators).toEqual([]);
  });
});

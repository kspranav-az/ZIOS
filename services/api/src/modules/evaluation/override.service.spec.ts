import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '@/common/errors';
import { OverrideService } from './override.service';
import { EvaluationRepository } from './evaluation.repository';
import { EvaluationScoreRepository } from './score.repository';
import { OverrideRepository } from './override.repository';
import { DatabaseService } from '@/modules/database';

function fakeDb(): DatabaseService {
  return {
    transaction: async (fn: (client: PoolClient) => Promise<unknown>) =>
      fn({ query: vi.fn() } as unknown as PoolClient),
  } as unknown as DatabaseService;
}

describe('OverrideService', () => {
  const orgId = randomUUID();
  const reportId = randomUUID();
  const scoreId = randomUUID();
  const userId = randomUUID();

  it('records an override and updates the score', async () => {
    const reports = {
      belongsToOrg: vi.fn().mockResolvedValue(true),
    } as unknown as EvaluationRepository;
    const scores = {
      findById: vi.fn().mockResolvedValue({ id: scoreId, reportId, score: 2 }),
      updateScore: vi.fn().mockResolvedValue(undefined),
    } as unknown as EvaluationScoreRepository;
    const overrides = {
      insert: vi
        .fn()
        .mockResolvedValue({ id: randomUUID(), reportId, scoreId, originalScore: 2, newScore: 4 }),
    } as unknown as OverrideRepository;

    const service = new OverrideService(fakeDb(), reports, scores, overrides);
    const result = await service.override(
      orgId,
      reportId,
      scoreId,
      4,
      'disagree_with_evidence',
      'better evidence',
      userId,
    );

    expect(reports.belongsToOrg).toHaveBeenCalledWith(reportId, orgId);
    expect(scores.findById).toHaveBeenCalledWith(scoreId, expect.anything());
    expect(overrides.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId,
        scoreId,
        originalScore: 2,
        newScore: 4,
        reasonCode: 'disagree_with_evidence',
      }),
      expect.anything(),
    );
    expect(result.newScore).toBe(4);
  });

  it('rejects scores outside 1..5', async () => {
    const service = new OverrideService(
      fakeDb(),
      { belongsToOrg: vi.fn() } as unknown as EvaluationRepository,
      {} as EvaluationScoreRepository,
      {} as OverrideRepository,
    );
    await expect(service.override(orgId, reportId, scoreId, 6, 'other')).rejects.toThrow(
      ApiException,
    );
    await expect(service.override(orgId, reportId, scoreId, 0, 'other')).rejects.toThrow(
      ApiException,
    );
  });

  it('rejects invalid reason codes', async () => {
    const service = new OverrideService(
      fakeDb(),
      { belongsToOrg: vi.fn() } as unknown as EvaluationRepository,
      {} as EvaluationScoreRepository,
      {} as OverrideRepository,
    );
    await expect(
      service.override(orgId, reportId, scoreId, 3, 'because_i_said_so'),
    ).rejects.toThrow(ApiException);
  });

  it('rejects overrides for scores outside the report', async () => {
    const reports = {
      belongsToOrg: vi.fn().mockResolvedValue(true),
    } as unknown as EvaluationRepository;
    const scores = {
      findById: vi.fn().mockResolvedValue({ id: scoreId, reportId: randomUUID(), score: 2 }),
    } as unknown as EvaluationScoreRepository;
    const service = new OverrideService(fakeDb(), reports, scores, {} as OverrideRepository);

    await expect(service.override(orgId, reportId, scoreId, 4, 'other')).rejects.toThrow(
      ApiException,
    );
  });

  it('rejects overrides for reports outside the org', async () => {
    const reports = {
      belongsToOrg: vi.fn().mockResolvedValue(false),
    } as unknown as EvaluationRepository;
    const service = new OverrideService(
      fakeDb(),
      reports,
      {} as EvaluationScoreRepository,
      {} as OverrideRepository,
    );

    await expect(service.override(orgId, reportId, scoreId, 4, 'other')).rejects.toThrow(
      ApiException,
    );
  });
});

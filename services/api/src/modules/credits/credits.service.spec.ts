import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '@/common/errors';
import type { OrgRepository } from '@/modules/org';
import { CreditsService } from './credits.service';

function fakeQueryable() {
  return {
    query: vi.fn(),
  };
}

function buildService(
  adjustCreditsImpl?: (
    id: string,
    delta: number,
  ) => Promise<{ id: string; creditsBalance: number }>,
) {
  const orgs = {
    adjustCredits: vi.fn().mockImplementation(
      adjustCreditsImpl ??
        (async (_id: string, delta: number) => ({
          id: randomUUID(),
          creditsBalance: 1000 + delta,
        })),
    ),
    findById: vi.fn().mockResolvedValue({ id: randomUUID(), creditsBalance: 1000 }),
  } as unknown as OrgRepository;

  const service = new CreditsService(orgs);
  return { service, orgs };
}

describe('CreditsService', () => {
  const orgId = randomUUID();

  it('debits credits and writes a ledger row', async () => {
    const q = fakeQueryable();
    const { service, orgs } = buildService();
    (q.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ id: randomUUID() }],
    });

    const result = await service.debit(orgId, 3, 'async_video_created', q, {
      sessionRef: randomUUID(),
      metadata: { roleId: 42 },
    });

    expect(orgs.adjustCredits).toHaveBeenCalledWith(orgId, -3, q);
    expect(result.balanceAfter).toBe(997);
    expect(result.entryId).toBeTruthy();
    const ledgerCall = (q.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(ledgerCall[1]).toEqual(expect.arrayContaining([orgId, -3, 997, 'async_video_created']));
  });

  it('credits credits and writes a ledger row', async () => {
    const q = fakeQueryable();
    const { service, orgs } = buildService();
    (q.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ id: randomUUID() }],
    });

    const result = await service.credit(orgId, 3, 'async_video_refund', q, {
      sessionRef: randomUUID(),
    });

    expect(orgs.adjustCredits).toHaveBeenCalledWith(orgId, 3, q);
    expect(result.balanceAfter).toBe(1003);
    const ledgerCall = (q.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(ledgerCall[1]).toEqual(expect.arrayContaining([orgId, 3, 1003, 'async_video_refund']));
  });

  it('throws ApiException when debit amount is not positive', async () => {
    const q = fakeQueryable();
    const { service } = buildService();

    await expect(service.debit(orgId, 0, 'async_video_created', q)).rejects.toThrow(ApiException);
    await expect(service.debit(orgId, -1, 'async_video_created', q)).rejects.toThrow(ApiException);
  });

  it('throws ApiException when credit amount is not positive', async () => {
    const q = fakeQueryable();
    const { service } = buildService();

    await expect(service.credit(orgId, 0, 'refund', q)).rejects.toThrow(ApiException);
    await expect(service.credit(orgId, -1, 'refund', q)).rejects.toThrow(ApiException);
  });

  it('throws ApiException(402) when org has insufficient credits', async () => {
    const q = fakeQueryable();
    const { service, orgs } = buildService();
    (orgs.adjustCredits as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('insufficient credits'),
    );

    await expect(service.debit(orgId, 3, 'async_video_created', q)).rejects.toThrow(ApiException);
    try {
      await service.debit(orgId, 3, 'async_video_created', q);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      const response = (err as ApiException).getResponse() as {
        statusCode: number;
        code: string;
      };
      expect(response.statusCode).toBe(402);
      expect(response.code).toBe('INSUFFICIENT_CREDITS');
    }
  });

  it('returns the current balance', async () => {
    const q = fakeQueryable();
    const { service } = buildService();

    const balance = await service.getBalance(orgId, q);
    expect(balance).toBe(1000);
  });
});

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '@/common/errors';
import type { DatabaseService } from '@/modules/database';
import { CreditsService } from './credits.service';

const accountId = randomUUID();
const orgId = randomUUID();

function fakeQueryable(opts?: { balance?: number; holderType?: 'org' | 'candidate' }) {
  const balance = opts?.balance ?? 997;
  const holderType = opts?.holderType ?? 'org';
  const query = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes('UPDATE credit_account')) {
      return Promise.resolve({ rows: [{ balance }], rowCount: 1 });
    }
    if (sql.includes('SELECT holder_type, holder_id')) {
      return Promise.resolve({ rows: [{ holder_type: holderType, holder_id: orgId }], rowCount: 1 });
    }
    if (sql.includes('INSERT INTO credit_ledger')) {
      return Promise.resolve({ rows: [{ id: randomUUID() }], rowCount: 1 });
    }
    if (sql.includes('SELECT id, holder_type, holder_id')) {
      return Promise.resolve({
        rows: [
          {
            id: accountId,
            holder_type: holderType,
            holder_id: orgId,
            balance,
            low_balance_threshold: 5,
            created_at: new Date(),
          },
        ],
        rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { query };
}

function buildService() {
  const db = { query: vi.fn() } as unknown as DatabaseService;
  const service = new CreditsService(db);
  return { service, db };
}

describe('CreditsService', () => {
  it('debits the account and writes a ledger row', async () => {
    const q = fakeQueryable({ balance: 997 });
    const { service } = buildService();

    const result = await service.debit(accountId, 3, 'async_video_created', q, {
      sessionRef: randomUUID(),
      metadata: { roleId: 42 },
    });

    expect(result.balanceAfter).toBe(997);
    expect(result.entryId).toBeTruthy();
    const ledgerCall = q.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO credit_ledger'),
    )!;
    expect(ledgerCall![1]).toEqual(
      expect.arrayContaining([accountId, orgId, -3, 997, 'async_video_created']),
    );
  });

  it('credits the account and writes a ledger row', async () => {
    const q = fakeQueryable({ balance: 1003 });
    const { service } = buildService();

    const result = await service.credit(accountId, 3, 'async_video_refund', q, {
      sessionRef: randomUUID(),
    });

    expect(result.balanceAfter).toBe(1003);
    const ledgerCall = q.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO credit_ledger'),
    )!;
    expect(ledgerCall![1]).toEqual(
      expect.arrayContaining([accountId, orgId, 3, 1003, 'async_video_refund']),
    );
  });

  it('writes org_id = NULL on ledger rows for candidate holders', async () => {
    const q = fakeQueryable({ holderType: 'candidate' });
    const { service } = buildService();

    await service.debit(accountId, 1, 'practice_start', q);

    const ledgerCall = q.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO credit_ledger'),
    )!;
    expect(ledgerCall![1]![1]).toBeNull();
  });

  it('throws ApiException when debit amount is not positive', async () => {
    const q = fakeQueryable();
    const { service } = buildService();

    await expect(service.debit(accountId, 0, 'async_video_created', q)).rejects.toThrow(ApiException);
    await expect(service.debit(accountId, -1, 'async_video_created', q)).rejects.toThrow(ApiException);
  });

  it('throws ApiException when credit amount is not positive', async () => {
    const q = fakeQueryable();
    const { service } = buildService();

    await expect(service.credit(accountId, 0, 'refund', q)).rejects.toThrow(ApiException);
    await expect(service.credit(accountId, -1, 'refund', q)).rejects.toThrow(ApiException);
  });

  it('throws ApiException(402) when the account has insufficient credits', async () => {
    const q = fakeQueryable();
    q.query.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE credit_account')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const { service } = buildService();

    try {
      await service.debit(accountId, 3, 'async_video_created', q);
      expect.unreachable('debit should have thrown');
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
    const q = fakeQueryable({ balance: 1000 });
    const { service } = buildService();

    const balance = await service.getBalance(accountId, q);
    expect(balance).toBe(1000);
  });

  it('ensureAccount inserts once and resolves idempotently', async () => {
    const q = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('ON CONFLICT')) {
          // First call inserts; second call conflicts and returns nothing.
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({ rows: [{ id: accountId }], rowCount: 1 });
      }),
    };
    const { service } = buildService();

    const first = await service.ensureAccount('candidate', orgId, q);
    const second = await service.ensureAccount('candidate', orgId, q);
    expect(first).toBe(accountId);
    expect(second).toBe(accountId);
    const conflictCalls = q.query.mock.calls.filter(
      (call: unknown[]) =>
        typeof (call as unknown[])[0] === 'string' &&
        ((call as unknown[])[0] as string).includes('ON CONFLICT'),
    );
    expect(conflictCalls).toHaveLength(2);
  });
});

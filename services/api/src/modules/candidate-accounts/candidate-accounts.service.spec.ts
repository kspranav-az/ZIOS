import { describe, expect, it } from 'vitest';
import { CandidateAccountsService } from './candidate-accounts.service';

/**
 * Unit coverage for the history link path (Phase 12e, Step 3). The
 * idempotent-link behavior itself is exercised end to end by
 * candidate-history.integration.spec.ts — here we pin the SQL contract
 * (exact-email citext guard) and the candidate-safe row mapping.
 */
function makeService(rows: Record<string, unknown>[], accountEmail = 'PriyA@X.Test') {
  const queries: string[] = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push(sql);
      if (sql.includes('FROM candidate c')) {
        return { rows, rowCount: rows.length } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    },
  };
  const accounts = {
    findById: async () => ({ id: 'acc-1', email: accountEmail }),
  };
  const service = new CandidateAccountsService(
    db as never,
    {} as never,
    accounts as never,
    {} as never,
    {} as never,
  );
  return { service, queries };
}

describe('CandidateAccountsService.getCompanyHistory', () => {
  it('links by exact email with a citext cast and maps candidate-safe fields only', async () => {
    const { service, queries } = makeService([
      {
        session_id: 's-1',
        org_name: 'ZeTheta Robotics',
        role_title: 'Backend Engineer',
        mode: 'video',
        status: 'completed',
        started_at: new Date('2026-09-23T10:00:00Z'),
        ended_at: new Date('2026-09-23T10:20:00Z'),
      },
    ]);

    const history = await service.getCompanyHistory('acc-1');

    const link = queries.find((q) => q.startsWith('UPDATE candidate'));
    expect(link).toBeDefined();
    // Exact-email guard: never fuzzy, and the citext cast keeps the match
    // case-insensitive (a plain node-pg text parameter would downcast to a
    // case-sensitive comparison and silently miss real links).
    expect(link).toContain('candidate_account_id IS NULL');
    expect(link).toContain('email = $2::citext');

    expect(history).toHaveLength(1);
    expect(history[0]).toEqual({
      sessionId: 's-1',
      orgName: 'ZeTheta Robotics',
      roleTitle: 'Backend Engineer',
      mode: 'video',
      status: 'completed',
      startedAt: '2026-09-23T10:00:00.000Z',
      completedAt: '2026-09-23T10:20:00.000Z',
      reportAvailable: false,
    });
  });

  it('treats a missing account as 404 and links nothing', async () => {
    const db = { query: async () => ({ rows: [], rowCount: 0 }) as never };
    const accounts = { findById: async () => null };
    const service = new CandidateAccountsService(
      db as never,
      {} as never,
      accounts as never,
      {} as never,
      {} as never,
    );
    await expect(service.getCompanyHistory('nope')).rejects.toMatchObject({
      status: 404,
    });
  });
});

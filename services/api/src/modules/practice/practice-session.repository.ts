import { Injectable } from '@nestjs/common';
import type {
  KitQuestion,
  PracticeMode,
  PracticeSession,
  PracticeSource,
} from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';

interface PracticeSessionRow {
  id: string;
  account_id: string;
  mode: PracticeMode;
  source: PracticeSource;
  title: string;
  snapshot: { questions: KitQuestion[] };
  status: string;
  consent_id: string | null;
  credit_account_id: string;
  recovery_token_hash: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface PracticeSessionRecord extends PracticeSession {
  creditAccountId: string;
  recoveryTokenHash: string | null;
  snapshot: { questions: KitQuestion[] };
}

function mapRow(row: PracticeSessionRow): PracticeSessionRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    mode: row.mode,
    source: row.source,
    title: row.title,
    status: row.status,
    consentId: row.consent_id,
    creditAccountId: row.credit_account_id,
    recoveryTokenHash: row.recovery_token_hash,
    snapshot: row.snapshot,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

const COLUMNS = `id, account_id, mode, source, title, snapshot, status, consent_id,
  credit_account_id, recovery_token_hash, started_at, completed_at, created_at`;

@Injectable()
export class PracticeSessionRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: {
      accountId: string;
      mode: PracticeMode;
      source: PracticeSource;
      title: string;
      snapshot: { questions: KitQuestion[] };
      creditAccountId: string;
      recoveryTokenHash: string;
    },
    q: Queryable,
  ): Promise<PracticeSessionRecord> {
    const result = await q.query(
      `INSERT INTO practice_session
         (account_id, mode, source, title, snapshot, credit_account_id, recovery_token_hash)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING ${COLUMNS}`,
      [
        input.accountId,
        input.mode,
        input.source,
        input.title,
        JSON.stringify(input.snapshot),
        input.creditAccountId,
        input.recoveryTokenHash,
      ],
    );
    return mapRow(result.rows[0] as PracticeSessionRow);
  }

  async findById(id: string, q: Queryable = this.db): Promise<PracticeSessionRecord | null> {
    const result = await q.query(`SELECT ${COLUMNS} FROM practice_session WHERE id = $1`, [id]);
    const row = result.rows[0] as PracticeSessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Atomic preflight staging: only a session still in 'consented' can be
   * staged. Concurrent callers (React StrictMode double-mount fires two
   * prefights back to back) race here; the loser gets null and must reload.
   */
  async claimPreflight(id: string, q: Queryable): Promise<PracticeSessionRecord | null> {
    const result = await q.query(
      `UPDATE practice_session SET status = 'preflight', updated_at = now()
       WHERE id = $1 AND status = 'consented' RETURNING ${COLUMNS}`,
      [id],
    );
    const row = result.rows[0] as PracticeSessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Atomic charge-point claim: consented/preflight → live with started_at.
   * Exactly one concurrent preflight wins (and therefore debits exactly
   * once); losers get null and replay idempotently without a second debit.
   */
  async claimLive(
    id: string,
    startedAt: Date,
    q: Queryable,
  ): Promise<PracticeSessionRecord | null> {
    const result = await q.query(
      `UPDATE practice_session SET status = 'live', started_at = $2, updated_at = now()
       WHERE id = $1 AND status IN ('consented', 'preflight') RETURNING ${COLUMNS}`,
      [id, startedAt],
    );
    const row = result.rows[0] as PracticeSessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  async updateStatus(
    id: string,
    status: string,
    q: Queryable,
    extras?: { startedAt?: Date; completedAt?: Date; consentId?: string },
  ): Promise<PracticeSessionRecord | null> {
    const sets = ['status = $2', 'updated_at = now()'];
    const params: unknown[] = [id, status];
    if (extras?.startedAt) {
      params.push(extras.startedAt);
      sets.push(`started_at = $${params.length}`);
    }
    if (extras?.completedAt) {
      params.push(extras.completedAt);
      sets.push(`completed_at = $${params.length}`);
    }
    if (extras?.consentId) {
      params.push(extras.consentId);
      sets.push(`consent_id = $${params.length}`);
    }
    const result = await q.query(
      `UPDATE practice_session SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
      params,
    );
    const row = result.rows[0] as PracticeSessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  async setRecoveryToken(id: string, tokenHash: string, q: Queryable): Promise<void> {
    await q.query(
      `UPDATE practice_session SET recovery_token_hash = $2, updated_at = now() WHERE id = $1`,
      [id, tokenHash],
    );
  }

  /** D11 COGS guardrail: completed practice mocks started today, per account. */
  async countCompletedToday(accountId: string, q: Queryable = this.db): Promise<number> {
    const result = await q.query(
      `SELECT COUNT(*) AS count FROM practice_session
       WHERE account_id = $1 AND status = 'completed'
         AND started_at >= date_trunc('day', now())`,
      [accountId],
    );
    return Number((result.rows[0] as { count: string }).count);
  }
}

import { Injectable } from '@nestjs/common';
import type { Queryable } from '@/modules/database';
import { DatabaseService } from '@/modules/database';
import { ApiException } from '@/common/errors';

export type CreditHolderType = 'org' | 'candidate';

export interface CreditAccount {
  id: string;
  holderType: CreditHolderType;
  holderId: string;
  balance: number;
  lowBalanceThreshold: number;
  createdAt: string;
}

export interface LedgerEntryInput {
  accountId: string;
  orgId: string | null;
  delta: number;
  balanceAfter: number;
  reason: string;
  sessionRef?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LedgerEntry {
  id: string;
  accountId: string;
  orgId: string | null;
  delta: number;
  balanceAfter: number;
  reason: string;
  sessionRef: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface CreditAccountRow {
  id: string;
  holder_type: CreditHolderType;
  holder_id: string;
  balance: number;
  low_balance_threshold: number;
  created_at: Date;
}

interface LedgerEntryRow {
  id: string;
  account_id: string;
  org_id: string | null;
  delta: number;
  balance_after: number;
  reason: string;
  session_ref: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

function mapAccountRow(row: CreditAccountRow): CreditAccount {
  return {
    id: row.id,
    holderType: row.holder_type,
    holderId: row.holder_id,
    balance: row.balance,
    lowBalanceThreshold: row.low_balance_threshold,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Generalized credit wallet (Phase 12, D1-D3): every balance lives on a
 * holder-typed `credit_account` row (`org` | `candidate`). The ledger is
 * append-only per account. For org holders, `org.credits_balance` is kept
 * in sync as a read cache (D2) — all writes flow through this service.
 *
 * Callers resolve the account first with `ensureAccount` (inside their own
 * transaction) and then mutate by `accountId`.
 */
@Injectable()
export class CreditsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Insert-if-absent for a holder's credit account. Idempotent under
   * concurrency (unique (holder_type, holder_id)). Must be called inside
   * the caller's transaction so the account and the mutation commit together.
   */
  async ensureAccount(
    holderType: CreditHolderType,
    holderId: string,
    q: Queryable = this.db,
  ): Promise<string> {
    const inserted = await q.query(
      `INSERT INTO credit_account (holder_type, holder_id)
       VALUES ($1, $2)
       ON CONFLICT (holder_type, holder_id) DO NOTHING
       RETURNING id`,
      [holderType, holderId],
    );
    const insertedId = (inserted.rows[0] as { id: string } | undefined)?.id;
    if (insertedId) return insertedId;
    const found = await q.query(
      `SELECT id FROM credit_account WHERE holder_type = $1 AND holder_id = $2`,
      [holderType, holderId],
    );
    const id = (found.rows[0] as { id: string } | undefined)?.id;
    if (!id) {
      throw new ApiException(500, 'ACCOUNT_RESOLVE_FAILED', 'credit account could not be resolved');
    }
    return id;
  }

  async getAccount(accountId: string, q: Queryable = this.db): Promise<CreditAccount> {
    const result = await q.query(
      `SELECT id, holder_type, holder_id, balance, low_balance_threshold, created_at
       FROM credit_account WHERE id = $1`,
      [accountId],
    );
    const row = result.rows[0] as CreditAccountRow | undefined;
    if (!row) {
      throw new ApiException(404, 'ACCOUNT_NOT_FOUND', 'credit account not found');
    }
    return mapAccountRow(row);
  }

  /**
   * Debits credits atomically. Throws ApiException(402) if the account has
   * insufficient credits.
   */
  async debit(
    accountId: string,
    amount: number,
    reason: string,
    q: Queryable,
    opts?: { sessionRef?: string; metadata?: Record<string, unknown> },
  ): Promise<{ balanceAfter: number; entryId: string }> {
    if (amount <= 0) {
      throw new ApiException(400, 'INVALID_AMOUNT', 'debit amount must be positive');
    }

    const balanceAfter = await this.adjustBalance(accountId, -amount, q);

    const entry = await this.writeLedger(
      {
        accountId,
        orgId: await this.orgCacheId(accountId, q),
        delta: -amount,
        balanceAfter,
        reason,
        sessionRef: opts?.sessionRef ?? null,
        metadata: opts?.metadata ?? {},
      },
      q,
    );

    return { balanceAfter, entryId: entry.id };
  }

  /**
   * Credits (refunds) credits atomically. Use a negative delta to debit.
   */
  async credit(
    accountId: string,
    amount: number,
    reason: string,
    q: Queryable,
    opts?: { sessionRef?: string; metadata?: Record<string, unknown> },
  ): Promise<{ balanceAfter: number; entryId: string }> {
    if (amount <= 0) {
      throw new ApiException(400, 'INVALID_AMOUNT', 'credit amount must be positive');
    }

    const balanceAfter = await this.adjustBalance(accountId, amount, q);
    const entry = await this.writeLedger(
      {
        accountId,
        orgId: await this.orgCacheId(accountId, q),
        delta: amount,
        balanceAfter,
        reason,
        sessionRef: opts?.sessionRef ?? null,
        metadata: opts?.metadata ?? {},
      },
      q,
    );

    return { balanceAfter, entryId: entry.id };
  }

  async getBalance(accountId: string, q: Queryable = this.db): Promise<number> {
    const account = await this.getAccount(accountId, q);
    return account.balance;
  }

  /** Append-only ledger, newest first (credits wallet UI, FR-E14). */
  async listLedger(accountId: string, limit = 100): Promise<LedgerEntry[]> {
    const result = await this.db.query(
      `SELECT id, account_id, org_id, delta, balance_after, reason, session_ref, metadata, created_at
       FROM credit_ledger WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [accountId, limit],
    );
    return (result.rows as LedgerEntryRow[]).map(mapLedgerRow);
  }

  /** True when a refund for this session was already issued (replay guard). */
  async hasRefundForSession(accountId: string, sessionId: string, reason: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT id FROM credit_ledger
       WHERE account_id = $1 AND session_ref = $2 AND reason = $3 LIMIT 1`,
      [accountId, sessionId, reason],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Sets the low-balance alert threshold on the account row (FR-E14-3). */
  async setLowBalanceThreshold(accountId: string, threshold: number): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE credit_account SET low_balance_threshold = $2 WHERE id = $1 RETURNING id`,
      [accountId, threshold],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async adjustBalance(accountId: string, delta: number, q: Queryable): Promise<number> {
    const result = await q.query(
      `UPDATE credit_account
       SET balance = balance + $2
       WHERE id = $1 AND balance + $2 >= 0
       RETURNING balance`,
      [accountId, delta],
    );
    const row = result.rows[0] as { balance: number } | undefined;
    if (!row) {
      throw new ApiException(402, 'INSUFFICIENT_CREDITS', 'not enough credits for this operation');
    }
    // Keep the org cache in sync (D2). Candidate holders have no org row.
    await q.query(
      `UPDATE "org" SET credits_balance = $2
       WHERE id = (SELECT holder_id FROM credit_account WHERE id = $1 AND holder_type = 'org')`,
      [accountId, row.balance],
    );
    return row.balance;
  }

  /** Ledger rows for org holders keep org_id populated (existing read paths). */
  private async orgCacheId(accountId: string, q: Queryable): Promise<string | null> {
    const result = await q.query(
      `SELECT holder_type, holder_id FROM credit_account WHERE id = $1`,
      [accountId],
    );
    const row = result.rows[0] as { holder_type: CreditHolderType; holder_id: string } | undefined;
    return row && row.holder_type === 'org' ? row.holder_id : null;
  }

  private async writeLedger(input: LedgerEntryInput, q: Queryable) {
    const result = await q.query(
      `INSERT INTO credit_ledger (account_id, org_id, delta, balance_after, reason, session_ref, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, account_id, org_id, delta, balance_after, reason, session_ref, metadata, created_at`,
      [
        input.accountId,
        input.orgId,
        input.delta,
        input.balanceAfter,
        input.reason,
        input.sessionRef ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return result.rows[0] as LedgerEntryRow;
  }
}

function mapLedgerRow(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    orgId: row.org_id,
    delta: row.delta,
    balanceAfter: row.balance_after,
    reason: row.reason,
    sessionRef: row.session_ref,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  };
}

import { Injectable } from '@nestjs/common';
import type { Queryable } from '@/modules/database';
import { OrgRepository } from '@/modules/org';
import { ApiException } from '@/common/errors';

export interface LedgerEntryInput {
  orgId: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  sessionRef?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LedgerEntry {
  id: string;
  orgId: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  sessionRef: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface LedgerEntryRow {
  id: string;
  org_id: string;
  delta: number;
  balance_after: number;
  reason: string;
  session_ref: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

/**
 * Minimal credit ledger for Phase 09b. Tracks every balance change and keeps
 * the org.credits_balance column in sync. Full wallet UI and payment gateway
 * live in Phase 10.
 */
@Injectable()
export class CreditsService {
  constructor(private readonly orgs: OrgRepository) {}

  /**
   * Debits credits atomically. Throws ApiException(402) if the org has
   * insufficient credits.
   */
  async debit(
    orgId: string,
    amount: number,
    reason: string,
    q: Queryable,
    opts?: { sessionRef?: string; metadata?: Record<string, unknown> },
  ): Promise<{ balanceAfter: number; entryId: string }> {
    if (amount <= 0) {
      throw new ApiException(400, 'INVALID_AMOUNT', 'debit amount must be positive');
    }

    let balanceAfter: number;
    try {
      const result = await this.orgs.adjustCredits(orgId, -amount, q);
      balanceAfter = result.creditsBalance;
    } catch {
      throw new ApiException(402, 'INSUFFICIENT_CREDITS', 'not enough credits for this operation');
    }

    const entry = await this.writeLedger(
      {
        orgId,
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
    orgId: string,
    amount: number,
    reason: string,
    q: Queryable,
    opts?: { sessionRef?: string; metadata?: Record<string, unknown> },
  ): Promise<{ balanceAfter: number; entryId: string }> {
    if (amount <= 0) {
      throw new ApiException(400, 'INVALID_AMOUNT', 'credit amount must be positive');
    }

    const result = await this.orgs.adjustCredits(orgId, amount, q);
    const entry = await this.writeLedger(
      {
        orgId,
        delta: amount,
        balanceAfter: result.creditsBalance,
        reason,
        sessionRef: opts?.sessionRef ?? null,
        metadata: opts?.metadata ?? {},
      },
      q,
    );

    return { balanceAfter: result.creditsBalance, entryId: entry.id };
  }

  async getBalance(orgId: string, q: Queryable = this.orgs['db']): Promise<number> {
    const org = await this.orgs.findById(orgId, q);
    if (!org) {
      throw new ApiException(404, 'ORG_NOT_FOUND', 'org not found');
    }
    return org.creditsBalance;
  }

  /** Append-only ledger, newest first (credits wallet UI, FR-E14). */
  async listLedger(orgId: string, limit = 100): Promise<LedgerEntry[]> {
    const result = await this.orgs['db'].query(
      `SELECT id, org_id, delta, balance_after, reason, session_ref, metadata, created_at
       FROM credit_ledger WHERE org_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [orgId, limit],
    );
    return (result.rows as LedgerEntryRow[]).map((row) => ({
      id: row.id,
      orgId: row.org_id,
      delta: row.delta,
      balanceAfter: row.balance_after,
      reason: row.reason,
      sessionRef: row.session_ref,
      metadata: row.metadata,
      createdAt: row.created_at.toISOString(),
    }));
  }

  /** True when a refund for this session was already issued (replay guard). */
  async hasRefundForSession(orgId: string, sessionId: string, reason: string): Promise<boolean> {
    const result = await this.orgs['db'].query(
      `SELECT id FROM credit_ledger
       WHERE org_id = $1 AND session_ref = $2 AND reason = $3 LIMIT 1`,
      [orgId, sessionId, reason],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async writeLedger(input: LedgerEntryInput, q: Queryable) {
    const result = await q.query(
      `INSERT INTO credit_ledger (org_id, delta, balance_after, reason, session_ref, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, org_id, delta, balance_after, reason, session_ref, metadata, created_at`,
      [
        input.orgId,
        input.delta,
        input.balanceAfter,
        input.reason,
        input.sessionRef ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return result.rows[0] as {
      id: string;
      org_id: string;
      delta: number;
      balance_after: number;
      reason: string;
      session_ref: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
    };
  }
}

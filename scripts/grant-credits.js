#!/usr/bin/env node
/**
 * Grant credits to a credit_account holder (credits wallet admin tool, FR-E14;
 * generalized for Phase 12 holder-typed accounts, D1).
 *
 * The account balance and a credit_ledger row (reason `admin_grant`) update
 * in one transaction, so the ledger stays the source of truth. For org
 * holders, org.credits_balance is kept in sync as a read cache.
 *
 * Usage:
 *   DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos \
 *     node scripts/grant-credits.js <orgSlug|orgName> <amount> [reason]
 *
 * Example:
 *   node scripts/grant-credits.js acme 500 "pilot top-up"
 */

import { withClient } from './lib/local-db-client.js';

const [orgRef, amountRaw, ...reasonParts] = process.argv.slice(2);
const reason = reasonParts.join(' ') || 'admin_grant';

if (!orgRef || !amountRaw) {
  console.error('usage: node scripts/grant-credits.js <orgName> <amount> [reason]');
  process.exit(1);
}
const amount = Number(amountRaw);
if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
  console.error('amount must be a non-zero integer between -1000000 and 1000000');
  process.exit(1);
}

try {
  const result = await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const orgRes = await client.query(`SELECT id, name FROM "org" WHERE name = $1`, [orgRef]);
      const org = orgRes.rows[0];
      if (!org) {
        throw new Error(`org "${orgRef}" not found`);
      }
      const accountRes = await client.query(
        `INSERT INTO credit_account (holder_type, holder_id)
         VALUES ('org', $1)
         ON CONFLICT (holder_type, holder_id) DO NOTHING
         RETURNING id, balance`,
        [org.id],
      );
      let account = accountRes.rows[0];
      if (!account) {
        const found = await client.query(
          `SELECT id, balance FROM credit_account WHERE holder_type = 'org' AND holder_id = $1`,
          [org.id],
        );
        account = found.rows[0];
      }
      const updated = await client.query(
        `UPDATE credit_account SET balance = balance + $2
         WHERE id = $1 AND balance + $2 >= 0
         RETURNING balance`,
        [account.id, amount],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(`balance would go negative for org "${orgRef}"`);
      }
      await client.query(`UPDATE "org" SET credits_balance = $2 WHERE id = $1`, [
        org.id,
        row.balance,
      ]);
      await client.query(
        `INSERT INTO credit_ledger (account_id, org_id, delta, balance_after, reason, metadata)
         VALUES ($1, $2, $3, $4, 'admin_grant', $5::jsonb)`,
        [account.id, org.id, amount, row.balance, JSON.stringify({ note: reason })],
      );
      await client.query('COMMIT');
      return { name: org.name, balance: row.balance };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  console.log(
    `✅ ${result.name}: ${amount > 0 ? '+' : ''}${amount} credits → balance ${result.balance} (reason: ${reason})`,
  );
} catch (error) {
  console.error(`❌ grant failed: ${error.message}`);
  process.exit(1);
}

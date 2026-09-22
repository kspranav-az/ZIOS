#!/usr/bin/env node
/**
 * Grant credits to an org (credits wallet admin tool, FR-E14).
 *
 * Writes through the same atomic adjustCredits semantics as the API: the
 * org balance and a credit_ledger row (reason `admin_grant`) update in one
 * transaction, so the ledger stays the source of truth.
 *
 * Usage:
 *   DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos \
 *     node scripts/grant-credits.js <orgSlug|orgName> <amount> <reason>
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
      const orgRes = await client.query(
        `UPDATE "org" SET credits_balance = credits_balance + $2
         WHERE name = $1 AND credits_balance + $2 >= 0
         RETURNING id, name, credits_balance`,
        [orgRef, amount],
      );
      const org = orgRes.rows[0];
      if (!org) {
        throw new Error(`org "${orgRef}" not found (or balance would go negative)`);
      }
      await client.query(
        `INSERT INTO credit_ledger (org_id, delta, balance_after, reason, metadata)
         VALUES ($1, $2, $3, 'admin_grant', $4::jsonb)`,
        [org.id, amount, org.credits_balance, JSON.stringify({ note: reason })],
      );
      await client.query('COMMIT');
      return org;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  console.log(
    `✅ ${result.name}: ${amount > 0 ? '+' : ''}${amount} credits → balance ${result.credits_balance} (reason: ${reason})`,
  );
} catch (error) {
  console.error(`❌ grant failed: ${error.message}`);
  process.exit(1);
}

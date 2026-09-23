#!/usr/bin/env node
/**
 * Grant credits to a credit_account holder (credits wallet admin tool, FR-E14;
 * generalized for Phase 12 holder-typed accounts, D1).
 *
 * The account balance and a credit_ledger row (reason `admin_grant`) update
 * in one transaction, so the ledger stays the source of truth. For org
 * holders, org.credits_balance is kept in sync as a read cache.
 *
 * Usage (org holder):
 *   DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos \
 *     node scripts/grant-credits.js <orgName> <amount> [reason]
 *
 * Usage (candidate holder, Ascend closed beta):
 *   node scripts/grant-credits.js --holder candidate --email <email> <amount> [reason]
 *
 * Example:
 *   node scripts/grant-credits.js acme 500 "pilot top-up"
 *   node scripts/grant-credits.js --holder candidate --email priya@example.com 50 "beta top-up"
 */

import { withClient } from './lib/local-db-client.js';

const argv = process.argv.slice(2);

let holderType = 'org';
let holderRef = null;
let amountRaw = null;
let reasonParts = [];

if (argv[0] === '--holder') {
  // Flag mode: --holder candidate --email <email> <amount> [reason]
  holderType = argv[1];
  const emailIdx = argv.indexOf('--email');
  if (holderType !== 'candidate' || emailIdx === -1 || !argv[emailIdx + 1]) {
    console.error('usage: node scripts/grant-credits.js --holder candidate --email <email> <amount> [reason]');
    process.exit(1);
  }
  holderRef = argv[emailIdx + 1];
  amountRaw = argv[emailIdx + 2];
  reasonParts = argv.slice(emailIdx + 3);
} else {
  holderRef = argv[0];
  amountRaw = argv[1];
  reasonParts = argv.slice(2);
}

const reason = reasonParts.join(' ') || 'admin_grant';

if (!holderRef || !amountRaw) {
  console.error('usage: node scripts/grant-credits.js <orgName> <amount> [reason]');
  console.error('   or: node scripts/grant-credits.js --holder candidate --email <email> <amount> [reason]');
  process.exit(1);
}
const amount = Number(amountRaw);
if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
  console.error('amount must be a non-zero integer between -1000000 and 1000000');
  process.exit(1);
}

async function upsertAccount(client, holderType, holderId) {
  const inserted = await client.query(
    `INSERT INTO credit_account (holder_type, holder_id)
     VALUES ($1, $2)
     ON CONFLICT (holder_type, holder_id) DO NOTHING
     RETURNING id, balance`,
    [holderType, holderId],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const found = await client.query(
    `SELECT id, balance FROM credit_account WHERE holder_type = $1 AND holder_id = $2`,
    [holderType, holderId],
  );
  return found.rows[0];
}

try {
  const result = await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      let account;
      let ledgerOrgId = null;
      let displayName;

      if (holderType === 'candidate') {
        const candRes = await client.query(
          `SELECT id, email FROM candidate_account WHERE email = $1`,
          [holderRef],
        );
        const candidate = candRes.rows[0];
        if (!candidate) {
          throw new Error(`candidate with email "${holderRef}" not found`);
        }
        account = await upsertAccount(client, 'candidate', candidate.id);
        displayName = candidate.email;
      } else {
        const orgRes = await client.query(`SELECT id, name FROM "org" WHERE name = $1`, [holderRef]);
        const org = orgRes.rows[0];
        if (!org) {
          throw new Error(`org "${holderRef}" not found`);
        }
        account = await upsertAccount(client, 'org', org.id);
        ledgerOrgId = org.id;
        displayName = org.name;
      }

      const updated = await client.query(
        `UPDATE credit_account SET balance = balance + $2
         WHERE id = $1 AND balance + $2 >= 0
         RETURNING balance`,
        [account.id, amount],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(`balance would go negative for "${holderRef}"`);
      }

      if (holderType === 'org') {
        await client.query(`UPDATE "org" SET credits_balance = $2 WHERE id = $1`, [
          ledgerOrgId,
          row.balance,
        ]);
      }

      await client.query(
        `INSERT INTO credit_ledger (account_id, org_id, delta, balance_after, reason, metadata)
         VALUES ($1, $2, $3, $4, 'admin_grant', $5::jsonb)`,
        [account.id, ledgerOrgId, amount, row.balance, JSON.stringify({ note: reason })],
      );
      await client.query('COMMIT');
      return { name: displayName, balance: row.balance };
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

#!/usr/bin/env node
/**
 * Sync the external Neon role-based question bank into ZIOS.
 *
 * Usage:
 *   # Dry-run (prints planned changes, does not write)
 *   EXTERNAL_QUESTIONS_DB_URL="postgresql://..." node scripts/sync-role-based-questions.js --dry-run
 *
 *   # Apply sync
 *   EXTERNAL_QUESTIONS_DB_URL="postgresql://..." node scripts/sync-role-based-questions.js
 *
 * The script performs a transactional full refresh of the `role_based_questions`
 * table and writes an entry to `role_based_question_sync_log`.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '..', '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
const cloudflareEnvFile = path.join(__dirname, '..', 'cloudflare.env');
const networkEnvFile = path.join(__dirname, '..', 'network.env');
if (existsSync(cloudflareEnvFile)) {
  process.loadEnvFile(cloudflareEnvFile);
} else if (existsSync(networkEnvFile)) {
  process.loadEnvFile(networkEnvFile);
}

import { query as queryExternal } from './lib/external-questions-db.js';
import { withClient as withLocalClient } from './lib/local-db-client.js';

const SOURCE_NAME = 'external-neon';

function parseArgs() {
  return {
    dryRun: process.argv.includes('--dry-run'),
  };
}

async function fetchExternalRows() {
  return queryExternal(
    `SELECT id AS external_id,
            role_id,
            role_name,
            question_number,
            difficulty_level,
            question_type,
            question_text,
            experience_target,
            created_at AS external_created_at,
            updated_at AS external_updated_at
     FROM interview_questions
     ORDER BY role_id, question_number;`,
  );
}

async function countLocalRows(client) {
  const result = await client.query('SELECT COUNT(*) AS count FROM role_based_questions;');
  return Number(result.rows[0].count);
}

async function insertSyncLog(
  client,
  { dryRun, rowsRead, rowsWritten, rowsDeleted, status, errorMessage },
) {
  await client.query(
    `INSERT INTO role_based_question_sync_log
       (source, started_at, completed_at, rows_read, rows_written, rows_deleted, dry_run, status, error_message)
     VALUES ($1, now(), now(), $2, $3, $4, $5, $6, $7);`,
    [SOURCE_NAME, rowsRead, rowsWritten, rowsDeleted, dryRun, status, errorMessage],
  );
}

async function applySync(rows) {
  return withLocalClient(async (client) => {
    const beforeCount = await countLocalRows(client);

    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM role_based_questions;');

      const insertSql = `
        INSERT INTO role_based_questions
          (external_id, role_id, role_name, question_number, difficulty_level,
           question_type, question_text, experience_target,
           external_created_at, external_updated_at, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
        ON CONFLICT (role_id, question_number) DO UPDATE SET
          external_id = EXCLUDED.external_id,
          role_name = EXCLUDED.role_name,
          difficulty_level = EXCLUDED.difficulty_level,
          question_type = EXCLUDED.question_type,
          question_text = EXCLUDED.question_text,
          experience_target = EXCLUDED.experience_target,
          external_created_at = EXCLUDED.external_created_at,
          external_updated_at = EXCLUDED.external_updated_at,
          synced_at = now();
      `;

      for (const row of rows) {
        await client.query(insertSql, [
          row.external_id,
          row.role_id,
          row.role_name,
          row.question_number,
          row.difficulty_level,
          row.question_type,
          row.question_text,
          row.experience_target,
          row.external_created_at,
          row.external_updated_at,
        ]);
      }

      await client.query('COMMIT');

      const afterCount = await countLocalRows(client);
      await insertSyncLog(client, {
        dryRun: false,
        rowsRead: rows.length,
        rowsWritten: afterCount,
        rowsDeleted: beforeCount,
        status: 'success',
        errorMessage: null,
      });

      return { beforeCount, afterCount };
    } catch (err) {
      await client.query('ROLLBACK');
      await insertSyncLog(client, {
        dryRun: false,
        rowsRead: rows.length,
        rowsWritten: 0,
        rowsDeleted: 0,
        status: 'failure',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });
}

async function dryRunSummary(rows) {
  return withLocalClient(async (client) => {
    const beforeCount = await countLocalRows(client);

    const roleCount = new Set(rows.map((r) => r.role_id)).size;

    await insertSyncLog(client, {
      dryRun: true,
      rowsRead: rows.length,
      rowsWritten: rows.length,
      rowsDeleted: beforeCount,
      status: 'dry_run',
      errorMessage: null,
    });

    return { beforeCount, roleCount };
  });
}

async function main() {
  const { dryRun } = parseArgs();

  console.log('External role-based questions — sync');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'}\n`);

  console.log('1. Fetching external rows...');
  const rows = await fetchExternalRows();
  console.log(`   ${rows.length} row(s) fetched from external DB.`);

  if (rows.length === 0) {
    console.warn('\n⚠️ No rows found in external DB. Aborting to avoid wiping local table.');
    process.exit(1);
  }

  if (dryRun) {
    const { beforeCount, roleCount } = await dryRunSummary(rows);
    console.log('\n📋 Dry-run summary:');
    console.log(`  Current local rows: ${beforeCount}`);
    console.log(`  External rows:      ${rows.length}`);
    console.log(`  Distinct roles:     ${roleCount}`);
    console.log(
      `  Planned action:     DELETE ${beforeCount} local rows, INSERT ${rows.length} external rows`,
    );
    console.log('\nNo changes were made.');
    return;
  }

  console.log('2. Applying full-refresh sync...');
  const { beforeCount, afterCount } = await applySync(rows);
  console.log('\n✅ Sync complete.');
  console.log(`  Previous local rows: ${beforeCount}`);
  console.log(`  Current local rows:  ${afterCount}`);
  console.log(`  Source rows:         ${rows.length}`);
}

main().catch((err) => {
  console.error('\n❌ Sync failed:', err.message);
  process.exit(1);
});

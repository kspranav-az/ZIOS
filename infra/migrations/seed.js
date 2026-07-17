#!/usr/bin/env node
/**
 * Question-bank seed runner (FR-E4-1).
 *
 *   pnpm --filter @zios/migrations seed     # or: pnpm seed (repo root)
 *
 * Loads the repo-root .env when present (real env vars win), connects to
 * DATABASE_URL, and inserts the generated bank items with deterministic ids
 * (INSERT ... ON CONFLICT (id) DO NOTHING), so re-runs are idempotent.
 * Requires migration 1784254913885 (question_bank_item) to have been applied.
 */
const { existsSync } = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '..', '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.');
  process.exit(1);
}

async function main() {
  const { Client } = require('pg');
  const { buildItems } = require('./seed-question-bank');

  const items = buildItems();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    let inserted = 0;
    await client.query('BEGIN');
    try {
      for (const item of items) {
        const result = await client.query(
          `INSERT INTO question_bank_item
             (id, role_family, topic, type, difficulty, prompt, options, rubric_lines, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            item.id,
            item.role_family,
            item.topic,
            item.type,
            item.difficulty,
            item.prompt,
            item.options === null ? null : JSON.stringify(item.options),
            JSON.stringify(item.rubric_lines),
            item.tags,
          ],
        );
        inserted += result.rowCount;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const stats = await client.query(
      `SELECT count(*)::int AS total,
              count(DISTINCT role_family)::int AS families,
              count(DISTINCT type)::int AS types
       FROM question_bank_item`,
    );
    const byType = await client.query(
      'SELECT type, count(*)::int AS n FROM question_bank_item GROUP BY type ORDER BY type',
    );
    const { total, families, types } = stats.rows[0];
    console.log(
      `question bank seed: ${inserted} inserted, ${items.length - inserted} already present (idempotent)`,
    );
    console.log(
      `bank now holds ${total} items across ${families} role families; per type: ${byType.rows.map((r) => `${r.type}=${r.n}`).join(', ')}`,
    );
    if (total < 500 || families < 10 || types < 4) {
      throw new Error(`seed invariant violated: need ≥500 items, ≥10 families, 4 types`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

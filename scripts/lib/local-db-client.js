#!/usr/bin/env node
/**
 * Reusable PostgreSQL client for the local ZIOS database.
 *
 * Reads the connection string from the DATABASE_URL environment variable.
 * Resolves `pg` from the API workspace so root-level scripts can reuse it.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..', '..', 'services', 'api');
const apiRequire = createRequire(path.join(apiRoot, 'package.json'));
const pg = apiRequire('pg');

const { Pool } = pg;

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. ' +
        'Ensure the repo-root .env is present or export DATABASE_URL, e.g.\n' +
        '  DATABASE_URL="postgresql://..." node scripts/sync-role-based-questions.js',
    );
  }
  return new Pool({ connectionString });
}

/**
 * Execute a callback with a pooled client. The client is released
 * automatically when the callback resolves or rejects.
 */
export async function withClient(callback) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Run a single query and return the rows.
 */
export async function query(text, params = []) {
  return withClient(async (client) => {
    const result = await client.query(text, params);
    return result.rows;
  });
}

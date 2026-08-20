#!/usr/bin/env node
/**
 * Reusable PostgreSQL client for the external questions database.
 *
 * Reads the connection string from the EXTERNAL_QUESTIONS_DB_URL
 * environment variable. Resolves `pg` from the API workspace so the
 * script can run from the repository root.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// `pg` is installed in the API workspace, not at the repository root.
// Create a require that resolves from the API package so root-level
// scripts can reuse the same dependency.
const apiRoot = path.resolve(__dirname, '..', '..', 'services', 'api');
const apiRequire = createRequire(path.join(apiRoot, 'package.json'));
const pg = apiRequire('pg');

const { Pool } = pg;

function getPool() {
  const connectionString = process.env.EXTERNAL_QUESTIONS_DB_URL;
  if (!connectionString) {
    throw new Error(
      'EXTERNAL_QUESTIONS_DB_URL is not set. ' +
        'Pass it as an environment variable, e.g.\n' +
        '  EXTERNAL_QUESTIONS_DB_URL="postgresql://..." node scripts/analyze-external-questions-db.js',
    );
  }
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
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

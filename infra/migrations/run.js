#!/usr/bin/env node
/**
 * Database migration runner (expand-migrate-contract, ADR-0003).
 *
 *   pnpm migrate            # apply all pending migrations (up)
 *   pnpm migrate up [n]     # apply all (or n) pending migrations
 *   pnpm migrate down [n]   # roll back the last (or n) migration(s)
 *
 * Loads the repo-root .env when present (real environment variables always
 * win) and runs node-pg-migrate against DATABASE_URL.
 */
const { existsSync } = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '..', '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const direction = process.argv[2] ?? 'up';
if (direction !== 'up' && direction !== 'down') {
  console.error(`usage: pnpm migrate [up|down] [count] — got '${direction}'`);
  process.exit(1);
}
const countArg = process.argv[3];
const count =
  countArg !== undefined ? Number.parseInt(countArg, 10) : direction === 'down' ? 1 : Infinity;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.');
  process.exit(1);
}

async function main() {
  const pgMigrate = require('node-pg-migrate');
  const runner = pgMigrate.runner ?? pgMigrate.default ?? pgMigrate;
  await runner({
    databaseUrl,
    dir: path.join(__dirname, 'migrations'),
    migrationsTable: 'pgmigrations',
    direction,
    count,
    verbose: true,
    log: console.log,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

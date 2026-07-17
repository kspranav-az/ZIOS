import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Integration specs read the compose stack coordinates (DATABASE_URL,
// SMTP_URL, …) from the repo-root .env; real environment variables always
// win. In CI (no .env) the integration suites skip themselves.
const envFile = path.resolve(__dirname, '../../.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// Keep pino quiet during tests unless a test opts back in.
process.env.LOG_LEVEL ??= 'silent';

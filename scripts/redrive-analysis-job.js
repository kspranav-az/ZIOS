#!/usr/bin/env node
/**
 * Re-drive a failed/DLQ'd analysis_job by re-adding its BullMQ job.
 *
 *   node scripts/redrive-analysis-job.js <analysisJobId>
 *
 * Reads the analysis_job row for the payload, re-enqueues on the same queue
 * the API worker consumes (`ANALYSIS_QUEUE_NAME`, default "analysis"). The
 * worker's markRunning accepts rows in 'pending' or 'failed' state, so no DB
 * reset is needed; on success the row flips to 'completed'. The existing DLQ
 * row is kept as the audit trail of the original failure.
 *
 * Pre-requisites: redis + api reachable via repo-root .env (DATABASE_URL,
 * REDIS_URL).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const apiRequire = createRequire(path.join(repoRoot, 'services', 'api', 'package.json'));
const { Queue } = apiRequire('bullmq');
const IORedis = apiRequire('ioredis');

const { query: dbQuery } = await import('./lib/local-db-client.js');

async function main() {
  const analysisJobId = process.argv[2];
  if (!analysisJobId) {
    throw new Error('usage: node scripts/redrive-analysis-job.js <analysisJobId>');
  }

  const rows = await dbQuery(`SELECT * FROM analysis_job WHERE id = $1`, [analysisJobId]);
  const job = rows[0];
  if (!job) {
    throw new Error(`analysis_job ${analysisJobId} not found`);
  }
  console.log(
    `job ${job.id}: kind=${job.kind} status=${job.status} attempts=${job.attempts} ` +
      `error=${job.error_code ?? '-'}`,
  );
  if (job.status === 'completed') {
    console.log('job already completed; nothing to do');
    return;
  }

  const payload = job.payload ?? {};
  const queueName = process.env.ANALYSIS_QUEUE_NAME ?? 'analysis';
  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue(queueName, { connection: redis });
  const bullJob = await queue.add('analyze', {
    analysisJobId: job.id,
    kind: job.kind,
    sessionId: job.session_id,
    questionId: job.question_id,
    inviteId: job.invite_id,
    objectName: payload.objectName,
    mediaKind: payload.mediaKind,
    includeTranscript: payload.includeTranscript,
    languageHint: payload.languageHint ?? undefined,
  });
  // Same retry policy the API uses (AnalysisQueue.add).
  console.log(`re-enqueued on queue "${queueName}" as BullMQ job ${bullJob.id}`);
  await queue.close();
  redis.disconnect();
}

main().catch((err) => {
  console.error('❌ Redrive failed:', err.message);
  process.exit(1);
});

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AsyncVideoInterviewCreated } from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  makeTestNamespace,
  postJson,
  signup,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('async-video-dlq.test');

describe.runIf(INTEGRATION_AVAILABLE)('Async video transcription DLQ', () => {
  let test: TestApp;
  let adminToken: string;
  const roleId = Math.floor(Math.random() * 1_000_000);
  const roleName = `Async DLQ Test Engineer ${randomUUID().slice(0, 8)}`;
  const previousQueueName = process.env.TRANSCRIPTION_QUEUE_NAME;

  beforeAll(async () => {
    // Isolate the test worker/queue from any running Docker API worker.
    process.env.TRANSCRIPTION_QUEUE_NAME = `async-video-transcription-dlq-${randomUUID()}`;
    process.env.ORCHESTRATOR_URL = 'http://localhost:8000';
    test = await bootApp();
    const signupResult = await signup(test.baseUrl, ns.email('admin'));
    adminToken = signupResult.token;
    // Seed credits so async-video creation can debit 3 credits per interview.
    await test.db.query(
      `UPDATE credit_account SET balance = 1000 WHERE holder_type = 'org' AND holder_id = $1`,
      [signupResult.org.id],
    );
    await test.db.query(`UPDATE org SET credits_balance = 1000 WHERE id = $1`, [signupResult.org.id]);

    await test.db.query(
      `INSERT INTO role_based_questions
       (id, role_id, role_name, question_number, difficulty_level, question_type, question_text, experience_target)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        roleId,
        roleName,
        1,
        'medium',
        'Project-Based Experience Validation',
        'Tell us about a time you resolved a conflict in a team.',
        '1-2 years',
      ],
    );
  });

  afterAll(async () => {
    await test.db.query('DELETE FROM role_based_questions WHERE role_name = $1', [roleName]);
    await ns.purge(test.db);
    await test.app.close();
    if (previousQueueName === undefined) {
      delete process.env.TRANSCRIPTION_QUEUE_NAME;
    } else {
      process.env.TRANSCRIPTION_QUEUE_NAME = previousQueueName;
    }
  });

  it('moves a permanently failed transcription job to the DLQ after retries', async () => {
    const previousOrchestrator = process.env.ORCHESTRATOR_URL;

    // A local HTTP server that fails immediately avoids long TCP timeouts.
    let requestCount = 0;
    const server = createServer((req, res) => {
      requestCount += 1;
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('transcription unavailable');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    process.env.ORCHESTRATOR_URL = `http://127.0.0.1:${address.port}`;

    try {
      const email = ns.email('candidate');
      const createRes = await postJson(
        test.baseUrl,
        '/async-video-interviews',
        {
          roleId,
          candidate: { name: 'Async DLQ Candidate', email },
          enableTranscription: true,
          // Pin the legacy transcription path so this suite exercises the
          // transcription_job DLQ (the analysis DLQ has its own suite).
          enableAnalysis: false,
        },
        bearer(adminToken),
      );
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as AsyncVideoInterviewCreated;

      const consentRes = await postJson(
        test.baseUrl,
        `/async-video-interviews/by-token/${created.token}/consent`,
        { name: 'Async DLQ Candidate', email },
      );
      expect(consentRes.status).toBe(200);
      const consentBody = (await consentRes.json()) as {
        session: { id: string; status: string };
        recoveryToken: string;
      };

      const q1 = created.questions[0]!;
      const bytes = Buffer.from('fake-video-webm-bytes');
      const blob = new Blob([bytes], { type: 'video/webm' });
      const form = new FormData();
      form.append('video', blob, 'answer.webm');
      form.append('durationSec', '45');
      const uploadRes = await fetch(
        `${test.baseUrl}/async-video-interviews/${encodeURIComponent(created.sessionId)}/questions/${encodeURIComponent(q1.id)}/video`,
        {
          method: 'POST',
          headers: { 'x-recovery-token': consentBody.recoveryToken },
          body: form,
        },
      );
      if (uploadRes.status !== 200) {
        console.error('upload failed:', uploadRes.status, await uploadRes.text());
      }
      expect(uploadRes.status).toBe(200);
      const uploadBody = (await uploadRes.json()) as {
        transcriptId: string;
        recordingUri: string;
        checksum: string;
      };

      let dlqRows = { rows: [] as Array<{ job_id: string; error_message: string }> };
      for (let i = 0; i < 120; i += 1) {
        dlqRows = await test.db.query(
          `SELECT job_id, error_message FROM transcription_job_dlq WHERE transcript_id = $1`,
          [uploadBody.transcriptId],
        );
        if (dlqRows.rows.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(dlqRows.rows).toHaveLength(1);
      expect(dlqRows.rows[0]?.job_id).toBeTruthy();
      expect(dlqRows.rows[0]?.error_message).toBeTruthy();

      const jobRows = await test.db.query(
        `SELECT status FROM transcription_job WHERE transcript_id = $1`,
        [uploadBody.transcriptId],
      );
      expect(jobRows.rows[0]?.status).toBe('pending');

      // The worker should have retried the configured number of times.
      expect(requestCount).toBeGreaterThanOrEqual(2);
    } finally {
      process.env.ORCHESTRATOR_URL = previousOrchestrator;
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  }, 60_000);
});

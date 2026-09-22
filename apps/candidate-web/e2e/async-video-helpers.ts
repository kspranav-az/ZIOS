import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
// @ts-expect-error local-db-client is plain JS; test helper only.
import { query } from '../../../scripts/lib/local-db-client.js';
import { API_BASE, postJson } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(__dirname, '..', '..', '..', '.env');
if (existsSync(envFile) && !process.env.DATABASE_URL) {
  process.loadEnvFile(envFile);
}

export const TEST_VIDEO_PATH = path.join(__dirname, 'fixtures', 'test-answer.webm');

export interface AsyncVideoInterviewCreated {
  sessionId: string;
  inviteId: string;
  candidateId: string;
  token: string;
  recoveryToken: string;
  expiresAt: string;
  questions: Array<{ id: string; prompt: string }>;
}

export async function seedRoleQuestions(roleId: number, roleName: string): Promise<void> {
  const values = [
    [
      randomUUID(),
      roleId,
      roleName,
      1,
      'medium',
      'Project-Based Experience Validation',
      'Tell us about a time you led a project under pressure.',
      '1-2 years',
    ],
    [
      randomUUID(),
      roleId,
      roleName,
      2,
      'medium',
      'Problem Solving',
      'How do you debug a production issue you cannot reproduce locally?',
      '1-2 years',
    ],
  ];
  for (const row of values) {
    await query(
      `INSERT INTO role_based_questions
       (id, role_id, role_name, question_number, difficulty_level, question_type, question_text, experience_target)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      row,
    );
  }
}

export async function cleanupRoleQuestions(roleName: string): Promise<void> {
  await query('DELETE FROM role_based_questions WHERE role_name = $1', [roleName]);
}

export async function seedCredits(orgId: string, amount: number = 1000): Promise<void> {
  await query(`UPDATE org SET credits_balance = credits_balance + $1 WHERE id = $2`, [
    amount,
    orgId,
  ]);
}

export async function createAsyncVideoInterview(
  adminToken: string,
  roleId: number,
  candidate: { name: string; email: string },
  opts: { enableTranscription?: boolean; maxDurationSec?: number; expiresInDays?: number } = {},
): Promise<AsyncVideoInterviewCreated> {
  const response = await postJson(
    '/async-video-interviews',
    {
      roleId,
      candidate,
      enableTranscription: opts.enableTranscription ?? true,
      maxDurationSec: opts.maxDurationSec ?? 180,
      expiresInDays: opts.expiresInDays ?? 180,
    },
    { authorization: `Bearer ${adminToken}` },
  );
  if (!response.ok) {
    throw new Error(
      `create async video interview failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as AsyncVideoInterviewCreated;
}

export async function consentAsyncVideoByToken(
  token: string,
  body: { name: string; email: string },
): Promise<{ session: { id: string; status: string }; recoveryToken: string }> {
  const response = await postJson(
    `/async-video-interviews/by-token/${encodeURIComponent(token)}/consent`,
    body,
  );
  if (!response.ok) {
    throw new Error(`async video consent failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as {
    session: { id: string; status: string };
    recoveryToken: string;
  };
}

export async function uploadVideoAnswer(
  sessionId: string,
  questionId: string,
  recoveryToken: string,
  videoPath: string = TEST_VIDEO_PATH,
  durationSec: number = 3,
): Promise<{
  transcriptId: string;
  recordingUri: string;
  checksum: string;
  transcript?: string;
  completed?: boolean;
}> {
  const buffer = readFileSync(videoPath);
  const blob = new Blob([buffer], { type: 'video/webm' });
  const form = new FormData();
  form.append('video', blob, 'answer.webm');
  form.append('durationSec', String(durationSec));

  const response = await fetch(
    `${API_BASE}/async-video-interviews/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/video`,
    {
      method: 'POST',
      headers: { 'x-recovery-token': recoveryToken },
      body: form,
    },
  );
  if (!response.ok) {
    throw new Error(`upload video answer failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as {
    transcriptId: string;
    recordingUri: string;
    checksum: string;
    transcript?: string;
    completed?: boolean;
  };
}

export async function getAsyncVideoQuestions(
  sessionId: string,
  recoveryToken: string,
): Promise<{
  questions: Array<{ id: string; prompt: string }>;
  answers: Array<{ questionId: string; answerData: unknown }>;
}> {
  const response = await fetch(
    `${API_BASE}/async-video-interviews/${encodeURIComponent(sessionId)}/questions`,
    {
      headers: { 'x-recovery-token': recoveryToken },
    },
  );
  if (!response.ok) {
    throw new Error(
      `get async video questions failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as {
    questions: Array<{ id: string; prompt: string }>;
    answers: Array<{ questionId: string; answerData: unknown }>;
  };
}

export async function waitForTranscript(
  transcriptId: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string | null> {
  const { timeoutMs = 10_000, intervalMs = 250 } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await query(
      'SELECT result, status FROM transcription_job WHERE transcript_id = $1',
      [transcriptId],
    )) as Array<{ result: string; status: string }>;
    if (rows.length > 0 && rows[0]?.status === 'completed') {
      return rows[0].result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`transcript for ${transcriptId} did not complete within ${timeoutMs}ms`);
}

export async function seedAsyncVideoAnswers(
  created: AsyncVideoInterviewCreated,
  recoveryToken: string,
  opts: { waitForTranscription?: boolean } = {},
): Promise<{ transcriptByQuestionId: Map<string, string> }> {
  const transcriptByQuestionId = new Map<string, string>();
  for (const question of created.questions) {
    const upload = await uploadVideoAnswer(created.sessionId, question.id, recoveryToken);
    if (opts.waitForTranscription) {
      const transcript = await waitForTranscript(upload.transcriptId);
      if (transcript) {
        transcriptByQuestionId.set(question.id, transcript);
      }
    }
  }
  return { transcriptByQuestionId };
}

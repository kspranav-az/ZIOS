import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AsyncVideoInterviewCreated,
  AsyncVideoQuestionsResponse,
  AsyncVideoReviewDetail,
} from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  makeTestNamespace,
  postJson,
  signup,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('async-video.test');

async function seedRoleQuestions(db: TestApp['db'], roleId: number, roleName: string) {
  await db.query(
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
      'Tell us about a time you led a project under pressure.',
      '1-2 years',
    ],
  );
  await db.query(
    `INSERT INTO role_based_questions
     (id, role_id, role_name, question_number, difficulty_level, question_type, question_text, experience_target)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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
  );
}

describe.runIf(INTEGRATION_AVAILABLE)('Async video interviews', () => {
  let test: TestApp;
  let adminToken: string;
  const roleId = Math.floor(Math.random() * 1_000_000);
  const roleName = `Async Test Engineer ${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    process.env.ORCHESTRATOR_URL = 'http://localhost:8000';
    test = await bootApp();
    const signupResult = await signup(test.baseUrl, ns.email('admin'));
    adminToken = signupResult.token;
    await seedRoleQuestions(test.db, roleId, roleName);
  });

  afterAll(async () => {
    await test.db.query('DELETE FROM role_based_questions WHERE role_name = $1', [roleName]);
    await ns.purge(test.db);
    await test.app.close();
  });

  it('creates an async video interview from role-based questions', async () => {
    const email = ns.email('candidate');
    const createRes = await postJson(
      test.baseUrl,
      '/async-video-interviews',
      {
        roleId,
        candidate: { name: 'Async Candidate', email },
        enableTranscription: true,
      },
      bearer(adminToken),
    );
    if (createRes.status !== 201) {
      console.error('create async interview failed:', createRes.status, await createRes.text());
    }
    expect(createRes.status).toBe(201);
    const body = (await createRes.json()) as AsyncVideoInterviewCreated;
    expect(body.sessionId).toBeTruthy();
    expect(body.token).toBeTruthy();
    expect(body.recoveryToken).toBeTruthy();
    expect(body.questions).toHaveLength(2);
  });

  it('records consent, returns questions, uploads a video answer, and saves a reviewer score', async () => {
    const email = ns.email('candidate2');
    const createRes = await postJson(
      test.baseUrl,
      '/async-video-interviews',
      {
        roleId,
        candidate: { name: 'Async Candidate 2', email },
        enableTranscription: true,
      },
      bearer(adminToken),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as AsyncVideoInterviewCreated;

    const consentRes = await postJson(
      test.baseUrl,
      `/async-video-interviews/by-token/${created.token}/consent`,
      { name: 'Async Candidate 2', email },
    );
    expect(consentRes.status).toBe(200);
    const consentBody = (await consentRes.json()) as {
      session: { id: string; status: string };
      recoveryToken: string;
    };
    expect(consentBody.session.status).toBe('live');

    const questionsRes = await fetch(
      `${test.baseUrl}/async-video-interviews/${created.sessionId}/questions`,
      { headers: { 'x-recovery-token': consentBody.recoveryToken } },
    );
    expect(questionsRes.status).toBe(200);
    const questionsBody = (await questionsRes.json()) as AsyncVideoQuestionsResponse;
    expect(questionsBody.questions).toHaveLength(2);
    expect(questionsBody.answers.every((a) => a.answerData === null)).toBe(true);

    const q1 = questionsBody.questions[0]!;
    const uploadRes = await uploadFakeVideo(
      test.baseUrl,
      created.sessionId,
      q1.id,
      consentBody.recoveryToken,
    );
    if (uploadRes.status !== 200) {
      console.error('upload failed:', uploadRes.status, await uploadRes.text());
    }
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as {
      transcriptId: string;
      recordingUri: string;
      checksum: string;
      transcript?: string;
    };
    expect(uploadBody.recordingUri).toContain('http');
    expect(uploadBody.checksum).toBeTruthy();

    // The upload response no longer includes the transcript; it is processed
    // asynchronously by the background worker. Poll until the job completes.
    let jobRows = { rows: [] as Array<{ status: string; result: string | null }> };
    for (let i = 0; i < 20; i += 1) {
      jobRows = await test.db.query(
        `SELECT status, result FROM transcription_job WHERE transcript_id = $1`,
        [uploadBody.transcriptId],
      );
      if (jobRows.rows[0]?.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(jobRows.rows).toHaveLength(1);
    expect(jobRows.rows[0]?.status).toBe('completed');
    expect(typeof jobRows.rows[0]?.result).toBe('string');

    const transcriptRow = await test.db.query(
      `SELECT answer_data -> 'videoAnswer' ->> 'transcript' AS transcript
       FROM session_transcript
       WHERE id = $1`,
      [uploadBody.transcriptId],
    );
    expect(transcriptRow.rows[0]?.transcript).toBeTruthy();

    const reviewRes = await fetch(
      `${test.baseUrl}/async-video-interviews/${created.sessionId}/review`,
      { headers: bearer(adminToken) },
    );
    expect(reviewRes.status).toBe(200);
    const review = (await reviewRes.json()) as AsyncVideoReviewDetail;
    const answer = review.answers.find((a) => a.questionId === q1.id);
    expect(answer).toBeTruthy();
    expect(getVideoUri(answer!)).toContain('http');

    const scoreRes = await postJson(
      test.baseUrl,
      `/async-video-interviews/${created.sessionId}/questions/${q1.id}/score`,
      { score: 4, remarks: 'Strong answer with concrete examples.' },
      bearer(adminToken),
    );
    expect(scoreRes.status).toBe(200);
    const scoreBody = (await scoreRes.json()) as { score: number; remarks: string };
    expect(scoreBody.score).toBe(4);
    expect(scoreBody.remarks).toBe('Strong answer with concrete examples.');
  });
});

function getVideoUri(answer: {
  answerData?: { videoAnswer?: { recordingUri?: string } } | null;
}): string | null {
  if (!answer.answerData?.videoAnswer) return null;
  return answer.answerData.videoAnswer.recordingUri ?? null;
}

async function uploadFakeVideo(
  baseUrl: string,
  sessionId: string,
  questionId: string,
  recoveryToken: string,
): Promise<Response> {
  const bytes = Buffer.from('fake-video-webm-bytes');
  const blob = new Blob([bytes], { type: 'video/webm' });
  const form = new FormData();
  form.append('video', blob, 'answer.webm');
  form.append('durationSec', '45');
  return fetch(
    `${baseUrl}/async-video-interviews/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/video`,
    {
      method: 'POST',
      headers: { 'x-recovery-token': recoveryToken },
      body: form,
    },
  );
}

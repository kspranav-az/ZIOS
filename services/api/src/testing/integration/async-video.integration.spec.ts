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
  let adminOrgId: string;
  const roleId = Math.floor(Math.random() * 1_000_000);
  const roleName = `Async Test Engineer ${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    process.env.ORCHESTRATOR_URL = 'http://localhost:8000';
    test = await bootApp();
    const signupResult = await signup(test.baseUrl, ns.email('admin'));
    adminToken = signupResult.token;
    adminOrgId = signupResult.org.id;
    await seedRoleQuestions(test.db, roleId, roleName);
    // Seed credits so async-video creation can debit 3 credits per interview.
    await test.db.query(`UPDATE org SET credits_balance = 1000 WHERE id = $1`, [adminOrgId]);
  });

  afterAll(async () => {
    // The async-video interview graph (sessions, transcripts, reports, ledger)
    // is left in place to avoid cleanup deadlocks with the background
    // transcription worker. Each test run mints a unique org + candidate emails
    // in the async-video.test namespace, so leftover rows do not cross-test.
    await test.db.query('DELETE FROM role_based_questions WHERE role_name = $1', [roleName]);
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
        // Pin the legacy transcription path (Phase 14 analysis path is covered
        // by analysis.integration.spec.ts).
        enableAnalysis: false,
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
        enableAnalysis: false,
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

  it('applies AI judge pre-fill and submits a scorecard that creates a report', async () => {
    const email = ns.email('candidate3');
    const createRes = await postJson(
      test.baseUrl,
      '/async-video-interviews',
      {
        roleId,
        candidate: { name: 'Async Candidate 3', email },
        enableTranscription: true,
        enableAnalysis: false,
      },
      bearer(adminToken),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as AsyncVideoInterviewCreated;

    const consentRes = await postJson(
      test.baseUrl,
      `/async-video-interviews/by-token/${created.token}/consent`,
      { name: 'Async Candidate 3', email },
    );
    expect(consentRes.status).toBe(200);
    const consentBody = (await consentRes.json()) as {
      session: { id: string; status: string };
      recoveryToken: string;
    };

    for (const question of created.questions) {
      const uploadRes = await uploadFakeVideo(
        test.baseUrl,
        created.sessionId,
        question.id,
        consentBody.recoveryToken,
      );
      expect(uploadRes.status).toBe(200);
    }

    const prefillRes = await postJson(
      test.baseUrl,
      `/async-video-interviews/${created.sessionId}/scorecard/prefill`,
      {},
      bearer(adminToken),
    );
    expect(prefillRes.status).toBe(200);
    const prefillBody = (await prefillRes.json()) as AsyncVideoReviewDetail;
    expect(prefillBody.scores).toHaveLength(2);
    expect(prefillBody.scores.every((s) => s.source === 'ai_prefill')).toBe(true);

    const submitRes = await postJson(
      test.baseUrl,
      `/async-video-interviews/${created.sessionId}/scorecard/submit`,
      { prefillAccepted: true, editCount: 0 },
      bearer(adminToken),
    );
    if (submitRes.status !== 200) {
      console.error('submit scorecard failed:', submitRes.status, await submitRes.text());
    }
    expect(submitRes.status).toBe(200);
    const submitBody = (await submitRes.json()) as { id: string; status: string };
    expect(submitBody.status).toBe('completed');

    const reportRes = await fetch(`${test.baseUrl}/reports/${created.sessionId}`, {
      headers: bearer(adminToken),
    });
    expect(reportRes.status).toBe(200);
    const reportBody = (await reportRes.json()) as {
      report: { status: string; overallRecommendation: number };
      scores: Array<{ score: number; source: string }>;
    };
    expect(reportBody.report.status).toBe('completed');
    expect(reportBody.report.overallRecommendation).toBeGreaterThanOrEqual(1);
    expect(reportBody.report.overallRecommendation).toBeLessThanOrEqual(5);
    expect(reportBody.scores).toHaveLength(2);
  });

  it('refunds async video credits only before any answer is uploaded', async () => {
    const email = ns.email('candidate4');
    const beforeBalance = await getOrgBalance(test.db, adminOrgId);

    const createRes = await postJson(
      test.baseUrl,
      '/async-video-interviews',
      {
        roleId,
        candidate: { name: 'Async Candidate 4', email },
        enableTranscription: false,
        enableAnalysis: false,
      },
      bearer(adminToken),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as AsyncVideoInterviewCreated;

    const afterCreateBalance = await getOrgBalance(test.db, adminOrgId);
    expect(afterCreateBalance).toBe(beforeBalance - 3);

    const refundRes1 = await postJson(
      test.baseUrl,
      `/async-video-interviews/${created.sessionId}/refund`,
      {},
      bearer(adminToken),
    );
    expect(refundRes1.status).toBe(200);
    const refundBody1 = (await refundRes1.json()) as { refunded: boolean };
    expect(refundBody1.refunded).toBe(true);

    const afterRefundBalance = await getOrgBalance(test.db, adminOrgId);
    expect(afterRefundBalance).toBe(beforeBalance);

    const email2 = ns.email('candidate5');
    const createRes2 = await postJson(
      test.baseUrl,
      '/async-video-interviews',
      {
        roleId,
        candidate: { name: 'Async Candidate 5', email: email2 },
        enableTranscription: false,
        enableAnalysis: false,
      },
      bearer(adminToken),
    );
    expect(createRes2.status).toBe(201);
    const created2 = (await createRes2.json()) as AsyncVideoInterviewCreated;

    const consentRes = await postJson(
      test.baseUrl,
      `/async-video-interviews/by-token/${created2.token}/consent`,
      { name: 'Async Candidate 5', email: email2 },
    );
    expect(consentRes.status).toBe(200);
    const consentBody = (await consentRes.json()) as { recoveryToken: string };

    const uploadRes = await uploadFakeVideo(
      test.baseUrl,
      created2.sessionId,
      created2.questions[0]!.id,
      consentBody.recoveryToken,
    );
    expect(uploadRes.status).toBe(200);

    const refundRes2 = await postJson(
      test.baseUrl,
      `/async-video-interviews/${created2.sessionId}/refund`,
      {},
      bearer(adminToken),
    );
    expect(refundRes2.status).toBe(200);
    const refundBody2 = (await refundRes2.json()) as { refunded: boolean };
    expect(refundBody2.refunded).toBe(false);
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

async function getOrgBalance(db: TestApp['db'], orgId: string): Promise<number> {
  const result = await db.query('SELECT credits_balance FROM org WHERE id = $1', [orgId]);
  return Number((result.rows[0] as { credits_balance: number }).credits_balance);
}

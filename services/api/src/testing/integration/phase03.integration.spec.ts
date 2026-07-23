import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ApiError,
  BulkInviteResponse,
  ConsentByTokenResponse,
  CreateCandidateInviteResponse,
  CreateKitBody,
  CreateQuestionBody,
  KitDetailResponse,
  KitVersion,
  PreflightResponse,
  SessionDetailResponse,
  TokenResolveResponse,
  TurnResponse,
} from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  extractOtp,
  makeTestNamespace,
  postJson,
  signup,
  waitForEmail,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('phase03.test');

async function createPublishedKit(
  test: TestApp,
  token: string,
): Promise<{ kit: KitDetailResponse['kit']; version: KitVersion }> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: 'Phase 03 Kit', role: 'Engineer', level: 'Mid' } satisfies CreateKitBody,
    bearer(token),
  );
  expect(create.status).toBe(201);
  const kit = ((await create.json()) as KitDetailResponse).kit;

  const q1: CreateQuestionBody = {
    type: 'open_ended',
    prompt: 'Tell us about a challenging project.',
    topic: 'Experience',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [{ id: randomUUID(), text: 'Clarity', weight: 1 }],
  };
  const q2: CreateQuestionBody = {
    type: 'open_ended',
    prompt: 'How do you handle tight deadlines?',
    topic: 'Behaviour',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'fixed',
    followupFixed: ['Give a concrete example.'],
    rubricLines: [{ id: randomUUID(), text: 'Structure', weight: 1 }],
  };

  for (const q of [q1, q2]) {
    const add = await postJson(test.baseUrl, `/kits/${kit.id}/questions`, q, bearer(token));
    expect(add.status).toBe(201);
  }

  const publish = await postJson(test.baseUrl, `/kits/${kit.id}/publish`, undefined, bearer(token));
  expect(publish.status).toBe(201);
  const version = (
    (await publish.json()) as { version: { id: string; kitId: string; version: number } }
  ).version;

  const getVersion = await fetch(`${test.baseUrl}/kits/${kit.id}/versions/${version.version}`, {
    headers: bearer(token),
  });
  expect(getVersion.status).toBe(200);
  const full = ((await getVersion.json()) as { version: KitVersion }).version;

  return { kit, version: full };
}

async function createStructuredAnswerKit(
  test: TestApp,
  token: string,
): Promise<{ kit: KitDetailResponse['kit']; version: KitVersion; mcqOptionId: string }> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: 'Phase 03 Structured Kit', role: 'Engineer', level: 'Mid' } satisfies CreateKitBody,
    bearer(token),
  );
  expect(create.status).toBe(201);
  const kit = ((await create.json()) as KitDetailResponse).kit;

  const mcqOptionId = randomUUID();
  const q1: CreateQuestionBody = {
    type: 'mcq_single',
    prompt: 'Pick one.',
    topic: 'Behaviour',
    timeLimitSec: 60,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    options: [
      { id: mcqOptionId, text: 'First', correct: true },
      { id: randomUUID(), text: 'Second', correct: false },
    ],
    rubricLines: [{ id: randomUUID(), text: 'Accuracy', weight: 1 }],
  };
  const q2: CreateQuestionBody = {
    type: 'rating_scale',
    prompt: 'Rate your confidence.',
    topic: 'Self-assessment',
    timeLimitSec: 60,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [{ id: randomUUID(), text: 'Honesty', weight: 1 }],
  };

  for (const q of [q1, q2]) {
    const add = await postJson(test.baseUrl, `/kits/${kit.id}/questions`, q, bearer(token));
    expect(add.status).toBe(201);
  }

  const publish = await postJson(test.baseUrl, `/kits/${kit.id}/publish`, undefined, bearer(token));
  expect(publish.status).toBe(201);
  const version = (
    (await publish.json()) as { version: { id: string; kitId: string; version: number } }
  ).version;

  const getVersion = await fetch(`${test.baseUrl}/kits/${kit.id}/versions/${version.version}`, {
    headers: bearer(token),
  });
  expect(getVersion.status).toBe(200);
  const full = ((await getVersion.json()) as { version: KitVersion }).version;

  return { kit, version: full, mcqOptionId };
}

describe.skipIf(!INTEGRATION_AVAILABLE)('Phase 03 invites & text interview (integration)', () => {
  let test: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    test = await bootApp();
    await ns.purge(test.db);
    const account = await signup(test.baseUrl, ns.email('admin'));
    adminToken = account.token;
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('runs the full invite → consent → text interview → completion flow', async () => {
    const { version } = await createPublishedKit(test, adminToken);

    const email = ns.email('candidate');
    const inviteRes = await postJson(
      test.baseUrl,
      '/invites',
      {
        kitVersionId: version.id,
        candidate: { name: 'Alice', email },
      },
      bearer(adminToken),
    );
    expect(inviteRes.status).toBe(201);
    const inviteBody = (await inviteRes.json()) as CreateCandidateInviteResponse;
    const token = inviteBody.token;

    const resolve = await fetch(`${test.baseUrl}/invites/by-token/${token}`);
    expect(resolve.status).toBe(200);
    const preview = (await resolve.json()) as TokenResolveResponse;
    expect(preview.kit.title).toBe('Phase 03 Kit');
    expect(preview.questions).toHaveLength(2);
    expect(preview.session).toBeNull();

    const consentRes = await postJson(test.baseUrl, `/invites/by-token/${token}/consent`, {
      name: 'Alice Smith',
    });
    expect(consentRes.status).toBe(200);
    const consentBody = (await consentRes.json()) as ConsentByTokenResponse;
    expect(consentBody.session.status).toBe('consented');
    expect(consentBody.recoveryToken).toBeTruthy();

    const recoveryToken = consentBody.recoveryToken;
    const sessionId = consentBody.session.id;

    const preflight = await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/preflight`,
      {},
      { 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(200);
    const preflightBody = (await preflight.json()) as PreflightResponse;
    expect(preflightBody.session.status).toBe('live');
    expect(preflightBody.turn.type).toBe('question');

    let turn = preflightBody.turn;
    const answers = ['answer one', 'answer two', 'followup answer'];
    let answerIndex = 0;
    while (turn.type !== 'wrapup') {
      expect(answerIndex).toBeLessThan(answers.length);
      const turnRes = await postJson(
        test.baseUrl,
        `/sessions/${sessionId}/turn`,
        { answer: answers[answerIndex] },
        { 'x-recovery-token': recoveryToken },
      );
      expect(turnRes.status).toBe(200);
      const turnBody = (await turnRes.json()) as TurnResponse;
      turn = turnBody.turn;
      answerIndex += 1;
    }

    expect(answerIndex).toBe(answers.length);

    const detail = await fetch(`${test.baseUrl}/sessions/${sessionId}`, {
      headers: bearer(adminToken),
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as SessionDetailResponse;
    expect(detailBody.session.status).toBe('completed');
    expect(detailBody.transcript).toHaveLength(3);
    expect(detailBody.transcript.every((t) => t.answerText)).toBe(true);
    expect(detailBody.events.some((e) => e.type === 'session.completed')).toBe(true);

    const tokenAfter = (await fetch(`${test.baseUrl}/invites/by-token/${token}`).then((r) =>
      r.json(),
    )) as TokenResolveResponse;
    expect(tokenAfter.invite.status).toBe('completed');
  });

  it('requires OTP before consent when otp_required is true', async () => {
    const { version } = await createPublishedKit(test, adminToken);
    const email = ns.email('otp-candidate');

    const inviteRes = await postJson(
      test.baseUrl,
      '/invites',
      {
        kitVersionId: version.id,
        candidate: { name: 'Bob', email },
        otpRequired: true,
      },
      bearer(adminToken),
    );
    expect(inviteRes.status).toBe(201);
    const { token } = (await inviteRes.json()) as CreateCandidateInviteResponse;

    const consentWithoutOtp = await postJson(
      test.baseUrl,
      `/invites/by-token/${token}/consent`,
      {},
    );
    expect(consentWithoutOtp.status).toBe(403);
    expect(((await consentWithoutOtp.json()) as ApiError).code).toBe('OTP_REQUIRED');

    const requestOtp = await postJson(test.baseUrl, `/invites/by-token/${token}/otp/request`, {});
    expect(requestOtp.status).toBe(200);

    const mail = await waitForEmail(email, 'verification code');
    const code = extractOtp(mail.text);

    const verify = await postJson(test.baseUrl, `/invites/by-token/${token}/otp/verify`, { code });
    expect(verify.status).toBe(200);

    const consent = await postJson(test.baseUrl, `/invites/by-token/${token}/consent`, {});
    expect(consent.status).toBe(200);
    expect(((await consent.json()) as ConsentByTokenResponse).session.status).toBe('consented');
  });

  it('recovers an abandoned session via the same invite link', async () => {
    const { version } = await createPublishedKit(test, adminToken);
    const email = ns.email('recover-candidate');

    const inviteRes = await postJson(
      test.baseUrl,
      '/invites',
      {
        kitVersionId: version.id,
        candidate: { name: 'Carol', email },
      },
      bearer(adminToken),
    );
    const { token } = (await inviteRes.json()) as CreateCandidateInviteResponse;

    const consent = (await postJson(test.baseUrl, `/invites/by-token/${token}/consent`, {}).then(
      (r) => r.json(),
    )) as ConsentByTokenResponse;
    const preflightRes = await postJson(
      test.baseUrl,
      `/sessions/${consent.session.id}/preflight`,
      {},
      { 'x-recovery-token': consent.recoveryToken },
    );
    expect(preflightRes.status).toBe(200);

    await postJson(
      test.baseUrl,
      `/sessions/${consent.session.id}/turn`,
      { answer: 'first answer' },
      { 'x-recovery-token': consent.recoveryToken },
    );

    const abandon = await postJson(
      test.baseUrl,
      `/sessions/${consent.session.id}/abandon`,
      {},
      { 'x-recovery-token': consent.recoveryToken },
    );
    expect(abandon.status).toBe(200);
    expect(((await abandon.json()) as { status: string }).status).toBe('abandoned');

    const reconsent = (await postJson(test.baseUrl, `/invites/by-token/${token}/consent`, {}).then(
      (r) => r.json(),
    )) as ConsentByTokenResponse;
    expect(reconsent.session.id).toBe(consent.session.id);
    expect(reconsent.session.status).toBe('consented');

    const resume = await postJson(
      test.baseUrl,
      `/sessions/${reconsent.session.id}/preflight`,
      {},
      { 'x-recovery-token': reconsent.recoveryToken },
    );
    expect(resume.status).toBe(200);
    const resumeBody = (await resume.json()) as PreflightResponse;
    expect(resumeBody.turn.type).toBe('question');
  });

  it('rejects preflight before consent is recorded', async () => {
    const { version } = await createPublishedKit(test, adminToken);
    const inviteRes = await postJson(
      test.baseUrl,
      '/invites',
      { kitVersionId: version.id, candidate: { name: 'NoConsent', email: ns.email('noconsent') } },
      bearer(adminToken),
    );
    const { token } = (await inviteRes.json()) as CreateCandidateInviteResponse;

    const fake = await postJson(
      test.baseUrl,
      '/sessions/00000000-0000-0000-0000-000000000000/preflight',
      {},
      { 'x-recovery-token': 'fake' },
    );
    expect(fake.status).toBe(404);

    const preview = (await fetch(`${test.baseUrl}/invites/by-token/${token}`).then((r) =>
      r.json(),
    )) as TokenResolveResponse;
    expect(preview.session).toBeNull();
  });

  it('bulk imports 500 candidates via CSV', async () => {
    const { version } = await createPublishedKit(test, adminToken);
    const lines = ['name,email,phone'];
    for (let i = 0; i < 500; i += 1) {
      lines.push(`Bulk ${i},${ns.email(`bulk-${i}`)},+91${i.toString().padStart(10, '0')}`);
    }
    const csv = Buffer.from(lines.join('\n'));

    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'candidates.csv');

    const bulk = await fetch(`${test.baseUrl}/invites/bulk?kitVersionId=${version.id}`, {
      method: 'POST',
      body: form,
      headers: bearer(adminToken),
    });
    expect(bulk.status).toBe(200);
    const body = (await bulk.json()) as BulkInviteResponse;
    expect(body.total).toBe(500);
    expect(body.successes).toBe(500);
    expect(body.errors).toBe(0);
  });

  it('accepts structured answers for mcq_single and rating_scale questions', async () => {
    const { version, mcqOptionId } = await createStructuredAnswerKit(test, adminToken);

    const email = ns.email('structured-candidate');
    const inviteRes = await postJson(
      test.baseUrl,
      '/invites',
      {
        kitVersionId: version.id,
        candidate: { name: 'Structured Alice', email },
      },
      bearer(adminToken),
    );
    expect(inviteRes.status).toBe(201);
    const { token } = (await inviteRes.json()) as CreateCandidateInviteResponse;

    const consentRes = await postJson(test.baseUrl, `/invites/by-token/${token}/consent`, {
      name: 'Structured Alice',
    });
    expect(consentRes.status).toBe(200);
    const { session, recoveryToken } = (await consentRes.json()) as ConsentByTokenResponse;

    const preflight = await postJson(
      test.baseUrl,
      `/sessions/${session.id}/preflight`,
      {},
      { 'x-recovery-token': recoveryToken },
    );
    expect(preflight.status).toBe(200);

    // Answer MCQ single with the correct option.
    const mcqRes = await postJson(
      test.baseUrl,
      `/sessions/${session.id}/turn`,
      { answerData: { type: 'mcq_single', selectedOptionIds: [mcqOptionId] } },
      { 'x-recovery-token': recoveryToken },
    );
    expect(mcqRes.status).toBe(200);

    // Answer rating scale.
    const ratingRes = await postJson(
      test.baseUrl,
      `/sessions/${session.id}/turn`,
      { answerData: { type: 'rating_scale', rating: 4 } },
      { 'x-recovery-token': recoveryToken },
    );
    expect(ratingRes.status).toBe(200);
    const ratingBody = (await ratingRes.json()) as TurnResponse;
    expect(ratingBody.turn.type).toBe('wrapup');

    const detail = await fetch(`${test.baseUrl}/sessions/${session.id}`, {
      headers: bearer(adminToken),
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as SessionDetailResponse;
    expect(detailBody.transcript).toHaveLength(2); // 2 answered questions; wrapup has no row
    const mcqRow = detailBody.transcript.find((t) => t.answerData?.type === 'mcq_single');
    expect(mcqRow).toBeTruthy();
    expect(mcqRow!.answerText).toBe('First');
    const ratingRow = detailBody.transcript.find((t) => t.answerData?.type === 'rating_scale');
    expect(ratingRow).toBeTruthy();
    expect(ratingRow!.answerText).toBe('Rating: 4/5');
  });

  it('sends a T-4h reminder when the invite is within the window', async () => {
    const { version } = await createPublishedKit(test, adminToken);
    const email = ns.email('reminder-candidate');

    const inviteRes = await postJson(
      test.baseUrl,
      '/invites',
      { kitVersionId: version.id, candidate: { name: 'Remind', email } },
      bearer(adminToken),
    );
    const invite = (await inviteRes.json()) as CreateCandidateInviteResponse;

    // Move expiry to 3 hours from now so the 4h window is due.
    await test.db.query("UPDATE invite SET expires_at = now() + interval '3 hours' WHERE id = $1", [
      invite.invite.id,
    ]);

    const run = await postJson(test.baseUrl, '/invites/-/reminders/run', {}, bearer(adminToken));
    expect(run.status).toBe(200);
    const runBody = (await run.json()) as { sent: number };
    expect(runBody.sent).toBeGreaterThanOrEqual(1);

    const mail = await waitForEmail(email, 'Final reminder');
    expect(mail.text).toContain('unsubscribe');
  });
});

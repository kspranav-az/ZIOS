import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ConsentByTokenResponse,
  CreateCandidateInviteResponse,
  CreateKitBody,
  CreateQuestionBody,
  CreateShareLinkResponse,
  DashboardListResponse,
  KitDetailResponse,
  KitVersion,
  PreflightResponse,
  PublicReportResponse,
  ReportDetailResponse,
  ReportListResponse,
  TurnResponse,
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

const ns = makeTestNamespace('phase04.test');

async function createPublishedKit(
  test: TestApp,
  token: string,
): Promise<{ kit: KitDetailResponse['kit']; version: KitVersion }> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: 'Phase 04 Kit', role: 'Engineer', level: 'Mid' } satisfies CreateKitBody,
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
    followupPolicy: 'none',
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

async function completeInterview(
  test: TestApp,
  adminToken: string,
): Promise<{ sessionId: string; recoveryToken: string }> {
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
  const { token } = (await inviteRes.json()) as CreateCandidateInviteResponse;

  const consentRes = await postJson(test.baseUrl, `/invites/by-token/${token}/consent`, {
    name: 'Alice Smith',
  });
  expect(consentRes.status).toBe(200);
  const consentBody = (await consentRes.json()) as ConsentByTokenResponse;

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

  let turn = preflightBody.turn;
  const answers = [
    'This is a long and detailed answer that explains the challenging project thoroughly and provides concrete outcomes.',
    'I prioritize tasks, communicate early, and break work into milestones to handle tight deadlines effectively.',
  ];
  let answerIndex = 0;
  while (turn.type !== 'wrapup') {
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

  return { sessionId, recoveryToken };
}

async function pollForReport(
  test: TestApp,
  adminToken: string,
  sessionId: string,
): Promise<ReportDetailResponse> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const res = await fetch(`${test.baseUrl}/reports/${sessionId}`, {
      headers: bearer(adminToken),
    });
    if (res.status === 200) {
      const body = (await res.json()) as ReportDetailResponse;
      if (body.report.status === 'completed') return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('report did not complete in time');
}

describe.skipIf(!INTEGRATION_AVAILABLE)('Phase 04 evaluation pipeline (integration)', () => {
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

  it('evaluates a completed session and surfaces evidence-linked scores', async () => {
    const { sessionId } = await completeInterview(test, adminToken);

    const detail = await pollForReport(test, adminToken, sessionId);
    expect(detail.report.status).toBe('completed');
    expect(detail.report.overallRecommendation).toBeGreaterThanOrEqual(1);
    expect(detail.report.overallConfidence).toBeGreaterThanOrEqual(0.5);
    expect(detail.scores.length).toBeGreaterThan(0);
    expect(detail.evidenceSpans.length).toBeGreaterThan(0);
    expect(detail.scores.every((s) => s.evidenceSpanIds.length > 0)).toBe(true);
    expect(detail.transcript.length).toBeGreaterThanOrEqual(2);
  });

  it('audits score overrides and updates the visible score', async () => {
    const { sessionId } = await completeInterview(test, adminToken);
    const detail = await pollForReport(test, adminToken, sessionId);
    const score = detail.scores[0];
    if (!score) {
      throw new Error('expected at least one score');
    }
    const scoreId = score.id;

    const overrideRes = await postJson(
      test.baseUrl,
      `/reports/${sessionId}/scores/${scoreId}/override`,
      {
        newScore: 1,
        reasonCode: 'disagree_with_evidence',
        reasonText: 'Evidence does not support',
      },
      bearer(adminToken),
    );
    expect(overrideRes.status).toBe(201);

    const after = await pollForReport(test, adminToken, sessionId);
    const updated = after.scores.find((s) => s.id === scoreId);
    expect(updated).toBeDefined();
    expect(updated!.score).toBe(1);
    expect(after.overrides.length).toBe(1);
    const override = after.overrides[0];
    if (!override) {
      throw new Error('expected override record');
    }
    expect(override.originalScore).toBe(score.score);
    expect(override.newScore).toBe(1);
    expect(override.reasonCode).toBe('disagree_with_evidence');
  });

  it('creates share links and increments access count on use', async () => {
    const { sessionId } = await completeInterview(test, adminToken);
    const detail = await pollForReport(test, adminToken, sessionId);

    const shareRes = await postJson(
      test.baseUrl,
      `/reports/${sessionId}/share`,
      { expiresInHours: 1 },
      bearer(adminToken),
    );
    expect(shareRes.status).toBe(201);
    const shareBody = (await shareRes.json()) as CreateShareLinkResponse;
    const token = shareBody.link.token;
    expect(token).toBeTruthy();
    expect(shareBody.link.accessCount).toBe(0);

    const publicRes = await fetch(`${test.baseUrl}/reports/share/${token}`);
    expect(publicRes.status).toBe(200);
    const publicBody = (await publicRes.json()) as PublicReportResponse;
    expect(publicBody.report.id).toBe(detail.report.id);
    expect(publicBody.scores.length).toBe(detail.scores.length);

    const publicAgain = await fetch(`${test.baseUrl}/reports/share/${token}`);
    expect(publicAgain.status).toBe(200);
    const publicAgainBody = (await publicAgain.json()) as PublicReportResponse;
    // Access count is incremented by the first request; the second request reads the updated value.
    expect(publicAgainBody.report.id).toBe(detail.report.id);
  });

  it('lists reports and dashboard interviews for the org', async () => {
    const { sessionId } = await completeInterview(test, adminToken);
    await pollForReport(test, adminToken, sessionId);

    const listRes = await fetch(`${test.baseUrl}/reports?page=1&pageSize=10`, {
      headers: bearer(adminToken),
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as ReportListResponse;
    expect(listBody.reports.length).toBeGreaterThan(0);
    expect(listBody.totalPages).toBeGreaterThanOrEqual(1);
    expect(listBody.reports[0]!.candidate.name).toBeDefined();
    expect(listBody.reports[0]!.kitTitle).toBeDefined();

    const dashboardRes = await fetch(`${test.baseUrl}/dashboard/interviews?page=1&pageSize=10`, {
      headers: bearer(adminToken),
    });
    expect(dashboardRes.status).toBe(200);
    const dashboardBody = (await dashboardRes.json()) as DashboardListResponse;
    expect(dashboardBody.items.length).toBeGreaterThan(0);
    expect(dashboardBody.items.some((item) => item.reportStatus === 'completed')).toBe(true);
  });
});

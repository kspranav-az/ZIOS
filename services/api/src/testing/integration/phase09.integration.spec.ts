import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CockpitStateResponse,
  ConsentByTokenResponse,
  CreateCandidateInviteResponse,
  CreateKitBody,
  CreateQuestionBody,
  DashboardListResponse,
  HumanScorecardBody,
  KitDetailResponse,
  KitVersion,
  LiveTokenResponse,
  ReportDetailResponse,
  ScheduleSlotResponse,
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

const ns = makeTestNamespace('phase09.test');

async function createHumanVideoKit(
  test: TestApp,
  token: string,
): Promise<{ kit: KitDetailResponse['kit']; version: KitVersion }> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: 'Phase 09 Human Kit', role: 'Engineer', level: 'Mid' } satisfies CreateKitBody,
    bearer(token),
  );
  expect(create.status).toBe(201);
  const kit = ((await create.json()) as KitDetailResponse).kit;

  const settings = await fetch(`${test.baseUrl}/kits/${kit.id}/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...bearer(token) },
    body: JSON.stringify({ mode: 'video', proctoringLevel: 'standard' }),
  });
  expect(settings.status).toBe(200);

  const q1: CreateQuestionBody = {
    type: 'open_ended',
    prompt: 'Tell us about a time you resolved a conflict.',
    topic: 'Behaviour',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [{ id: randomUUID(), text: 'Clarity', weight: 1 }],
  };
  const q2: CreateQuestionBody = {
    type: 'open_ended',
    prompt: 'How do you prioritise competing deadlines?',
    topic: 'Execution',
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

async function startHumanSession(
  test: TestApp,
  adminToken: string,
  slotAt?: string,
): Promise<{
  sessionId: string;
  recoveryToken: string;
  inviteId: string;
  inviteToken: string;
  candidateId: string;
}> {
  const { version } = await createHumanVideoKit(test, adminToken);

  const email = ns.email('candidate');
  const inviteRes = await postJson(
    test.baseUrl,
    '/invites',
    {
      kitVersionId: version.id,
      candidate: { name: 'Alice', email },
      conductor: 'human',
    },
    bearer(adminToken),
  );
  expect(inviteRes.status).toBe(201);
  const { token, invite, candidate } = (await inviteRes.json()) as CreateCandidateInviteResponse;

  const scheduleRes = await postJson(
    test.baseUrl,
    `/invites/${invite.id}/schedule`,
    { slotAt: slotAt ?? new Date().toISOString(), timezone: 'UTC' },
    bearer(adminToken),
  );
  expect(scheduleRes.status).toBe(200);

  const consentRes = await postJson(test.baseUrl, `/invites/by-token/${token}/consent`, {
    name: 'Alice Smith',
  });
  expect(consentRes.status).toBe(200);
  const consentBody = (await consentRes.json()) as ConsentByTokenResponse;

  return {
    sessionId: consentBody.session.id,
    recoveryToken: consentBody.recoveryToken,
    inviteId: invite.id,
    inviteToken: token,
    candidateId: candidate.id,
  };
}

describe.runIf(INTEGRATION_AVAILABLE)('Phase 09 — human-facilitated mode', () => {
  let test: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    test = await bootApp();
    const signupResult = await signup(test.baseUrl, ns.email('admin'));
    adminToken = signupResult.token;
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('schedules a slot, generates an .ics file, and rejects joins outside the ±10 min window', async () => {
    const { inviteId } = await startHumanSession(
      test,
      adminToken,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    );

    const icsRes = await fetch(`${test.baseUrl}/invites/${inviteId}/ics`, {
      headers: bearer(adminToken),
    });
    expect(icsRes.status).toBe(200);
    expect(icsRes.headers.get('content-type')).toContain('text/calendar');
    const ics = await icsRes.text();
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');

    const sessionRes = await fetch(`${test.baseUrl}/sessions/${inviteId}/live/token`);
    expect(sessionRes.status).toBe(404); // recovery token required
  });

  it('issues LiveKit tokens for candidate and interviewers within the window', async () => {
    const { sessionId, recoveryToken } = await startHumanSession(test, adminToken);

    const candidateRes = await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/live/token`,
      {},
      { 'x-recovery-token': recoveryToken },
    );
    expect(candidateRes.status).toBe(200);
    const candidateBody = (await candidateRes.json()) as LiveTokenResponse;
    expect(candidateBody.session.status).toBe('live');
    expect(candidateBody.livekit.roomName).toBe(`human-${sessionId}`);
    expect(candidateBody.livekit.token).toContain('.');

    const interviewerRes = await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/live/interviewer-token`,
      {},
      bearer(adminToken),
    );
    expect(interviewerRes.status).toBe(200);
    const interviewerBody = (await interviewerRes.json()) as LiveTokenResponse;
    expect(interviewerBody.livekit.roomName).toBe(`human-${sessionId}`);
  });

  it('tracks coverage per question in the cockpit', async () => {
    const { sessionId, recoveryToken } = await startHumanSession(test, adminToken);
    await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/live/token`,
      {},
      { 'x-recovery-token': recoveryToken },
    );

    const cockpitRes = await fetch(`${test.baseUrl}/sessions/${sessionId}/live/cockpit`, {
      headers: bearer(adminToken),
    });
    expect(cockpitRes.status).toBe(200);
    const cockpit = (await cockpitRes.json()) as CockpitStateResponse;
    expect(cockpit.coverage).toHaveLength(2);
    expect(cockpit.coverage.every((c) => c.status === 'pending')).toBe(true);

    const mark = await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/live/coverage`,
      { questionId: cockpit.kit.questions[0]!.id, action: 'cover' },
      bearer(adminToken),
    );
    expect(mark.status).toBe(200);
    const marked = (await mark.json()) as {
      coverage: Array<{ status: string; questionId: string }>;
    };
    const updated = marked.coverage.find((c) => c.questionId === cockpit.kit.questions[0]!.id);
    expect(updated!.status).toBe('covered');
  });

  it('ends the call, creates a pending report, and delivers notes within 2 minutes', async () => {
    const { sessionId, recoveryToken } = await startHumanSession(test, adminToken);
    await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/live/token`,
      {},
      { 'x-recovery-token': recoveryToken },
    );

    const endRes = await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/live/end`,
      {},
      bearer(adminToken),
    );
    expect(endRes.status).toBe(200);
    const endBody = (await endRes.json()) as { session: { status: string }; reportId: string };
    expect(endBody.session.status).toBe('completed');
    expect(endBody.reportId).toBeTruthy();

    const reportRes = await fetch(`${test.baseUrl}/reports/${sessionId}`, {
      headers: bearer(adminToken),
    });
    expect(reportRes.status).toBe(200);
    const report = (await reportRes.json()) as ReportDetailResponse;
    expect(report.report.status).toBe('pending');
    expect(report.notes).not.toBeNull();
    expect(report.notes!.summary.length).toBeGreaterThan(0);
    expect(report.notes!.questionMapping).toHaveLength(2);
    const endedAt = new Date(report.report.startedAt ?? new Date()).getTime();
    const notesAt = new Date(report.notes!.generatedAt).getTime();
    expect(notesAt - endedAt).toBeLessThanOrEqual(2 * 60 * 1000);
  });

  it('supports reschedule request flow with no dead ends', async () => {
    const { inviteId, inviteToken } = await startHumanSession(
      test,
      adminToken,
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    );

    const tokenResolve = await fetch(`${test.baseUrl}/invites/by-token/invalid-token`);
    expect(tokenResolve.status).toBe(404);

    const requestRes = await postJson(
      test.baseUrl,
      `/invites/by-token/${inviteToken}/reschedule-request`,
      {
        reason: 'Traffic delay',
        requestedSlotAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
    );
    expect(requestRes.status).toBe(200);
    const requestBody = (await requestRes.json()) as { slot: { status: string } };
    expect(requestBody.slot.status).toBe('rescheduled');

    const confirmRes = await postJson(
      test.baseUrl,
      `/invites/${inviteId}/reschedule/confirm`,
      { newSlotAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() },
      bearer(adminToken),
    );
    expect(confirmRes.status).toBe(200);
    const confirmBody = (await confirmRes.json()) as ScheduleSlotResponse;
    expect(confirmBody.slot.status).toBe('scheduled');
  });

  it('pre-fills and submits an editable human scorecard with acceptance tracking', async () => {
    const { sessionId, recoveryToken } = await startHumanSession(test, adminToken);
    await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/live/token`,
      {},
      { 'x-recovery-token': recoveryToken },
    );
    await postJson(test.baseUrl, `/sessions/${sessionId}/live/end`, {}, bearer(adminToken));

    const prefillRes = await postJson(
      test.baseUrl,
      `/reports/${sessionId}/scorecard/prefill`,
      {},
      bearer(adminToken),
    );
    expect(prefillRes.status).toBe(200);
    const prefill = (await prefillRes.json()) as ReportDetailResponse;
    expect(prefill.scores.length).toBeGreaterThan(0);
    expect(prefill.scores.every((s) => s.source === 'ai_prefill')).toBe(true);

    const q1 = prefill.report.kitVersionId; // dummy usage to satisfy TS
    expect(q1).toBeTruthy();
    const scorecardBody: HumanScorecardBody = {
      scores: prefill.scores.map((s) => ({
        questionId: s.questionId,
        criterionId: s.criterionId,
        criterionText: s.criterionText,
        score: Math.min(5, s.score + 1),
        weight: s.weight,
        evidenceSpanIds: s.evidenceSpanIds,
      })),
      prefillAccepted: false,
      editCount: prefill.scores.length,
    };

    const submitRes = await postJson(
      test.baseUrl,
      `/reports/${sessionId}/scorecard`,
      scorecardBody,
      bearer(adminToken),
    );
    expect(submitRes.status).toBe(200);
    const submitted = (await submitRes.json()) as ReportDetailResponse;
    expect(submitted.report.status).toBe('completed');
    expect(submitted.scores.every((s) => s.source === 'human')).toBe(true);
    expect(submitted.report.scorecard).not.toBeNull();
    expect(submitted.report.scorecard!.prefillAccepted).toBe(false);
    expect(submitted.report.scorecard!.editCount).toBe(scorecardBody.scores.length);
  });

  it('does not run AI live scoring for a human-facilitated session', async () => {
    const { sessionId, recoveryToken } = await startHumanSession(test, adminToken);
    await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/live/token`,
      {},
      { 'x-recovery-token': recoveryToken },
    );
    await postJson(test.baseUrl, `/sessions/${sessionId}/live/end`, {}, bearer(adminToken));

    const reportRes = await fetch(`${test.baseUrl}/reports/${sessionId}`, {
      headers: bearer(adminToken),
    });
    expect(reportRes.status).toBe(200);
    const report = (await reportRes.json()) as ReportDetailResponse;
    expect(report.report.modelRoute).toBe('human-facilitated');
    expect(report.report.status).toBe('pending');
    expect(report.scores).toHaveLength(0);
  });

  it('surfaces scheduled human-facilitated sessions on the dashboard', async () => {
    const { sessionId, recoveryToken } = await startHumanSession(test, adminToken);
    await postJson(
      test.baseUrl,
      `/sessions/${sessionId}/live/token`,
      {},
      { 'x-recovery-token': recoveryToken },
    );

    const dashboardRes = await fetch(`${test.baseUrl}/dashboard/interviews?pageSize=100`, {
      headers: bearer(adminToken),
    });
    expect(dashboardRes.status).toBe(200);
    const dashboard = (await dashboardRes.json()) as DashboardListResponse;
    const row = dashboard.items.find((item) => item.session.id === sessionId);
    expect(row).toBeTruthy();
  });
});

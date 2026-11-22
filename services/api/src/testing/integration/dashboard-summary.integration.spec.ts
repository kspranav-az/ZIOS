import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ConsentByTokenResponse,
  CreateCandidateInviteResponse,
  CreateKitBody,
  CreateQuestionBody,
  DashboardSummaryResponse,
  KitDetailResponse,
  KitVersion,
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

const ns = makeTestNamespace('dashboard-summary.test');

async function createPublishedKit(
  test: TestApp,
  token: string,
): Promise<KitVersion> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: 'Dashboard Summary Kit', role: 'Engineer', level: 'Mid' } satisfies CreateKitBody,
    bearer(token),
  );
  expect(create.status).toBe(201);
  const kit = ((await create.json()) as KitDetailResponse).kit;

  const question: CreateQuestionBody = {
    type: 'open_ended',
    prompt: 'Tell us about a project you are proud of.',
    topic: 'Experience',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [{ id: 'r1', text: 'Clarity', weight: 1 }],
  };
  const qRes = await postJson(
    test.baseUrl,
    `/kits/${kit.id}/questions`,
    question,
    bearer(token),
  );
  expect(qRes.status).toBe(201);

  const publish = await postJson(test.baseUrl, `/kits/${kit.id}/publish`, undefined, bearer(token));
  expect(publish.status).toBe(201);
  return ((await publish.json()) as { version: KitVersion }).version;
}

describe.runIf(INTEGRATION_AVAILABLE)('Dashboard summary endpoint', () => {
  let test: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    test = await bootApp();
    adminToken = (await signup(test.baseUrl, ns.email('admin'))).token;
  }, 120_000);

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('returns org-scoped aggregates and awaits nothing for an empty org', async () => {
    const res = await fetch(`${test.baseUrl}/dashboard/summary`, { headers: bearer(adminToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardSummaryResponse;
    expect(body.stats).toEqual({
      totalCandidates: 0,
      activeJobs: 0,
      totalInterviews: 0,
      pendingReviews: 0,
      liveNow: 0,
    });
    expect(body.pipeline.sourced).toBe(0);
    expect(body.timeToHireDays).toBeNull();
    expect(body.awaiting).toEqual([]);
  });

  it('reflects kits, candidates, and in-flight sessions', async () => {
    const version = await createPublishedKit(test, adminToken);

    // Candidate 1: invited + consented → session exists, appears in awaiting.
    const invited = await postJson(
      test.baseUrl,
      '/invites',
      {
        kitVersionId: version.id,
        candidate: { name: 'Dash Candidate One', email: ns.email('c1') },
      },
      bearer(adminToken),
    );
    expect(invited.status).toBe(201);
    const { token: token1 } = (await invited.json()) as CreateCandidateInviteResponse;
    const consent = await postJson(test.baseUrl, `/invites/by-token/${token1}/consent`, {
      name: 'Dash Candidate One',
    });
    expect(consent.status).toBe(200);
    await consent.json() as ConsentByTokenResponse;

    // Candidate 2: invited only (no consent yet) → counted, no session.
    const invited2 = await postJson(
      test.baseUrl,
      '/invites',
      {
        kitVersionId: version.id,
        candidate: { name: 'Dash Candidate Two', email: ns.email('c2') },
      },
      bearer(adminToken),
    );
    expect(invited2.status).toBe(201);

    const res = await fetch(`${test.baseUrl}/dashboard/summary`, { headers: bearer(adminToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardSummaryResponse;

    expect(body.stats.totalCandidates).toBe(2);
    expect(body.stats.activeJobs).toBe(1);
    expect(body.stats.totalInterviews).toBe(1);
    expect(body.stats.pendingReviews).toBe(0);
    expect(body.stats.liveNow).toBe(0);

    expect(body.pipeline.sourced).toBe(1);
    expect(body.pipeline.applied).toBe(1);
    expect(body.pipeline.screening).toBe(0);
    expect(body.pipeline.offers).toBe(0);

    expect(body.awaiting).toHaveLength(1);
    expect(body.awaiting[0]?.candidateName).toBe('Dash Candidate One');
    expect(body.awaiting[0]?.status).toBe('consented');
  });

  it('rejects unauthenticated requests', async () => {
    const res = await fetch(`${test.baseUrl}/dashboard/summary`);
    expect(res.status).toBe(401);
  });
});

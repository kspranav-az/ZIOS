import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CreateCandidateInviteResponse,
  CreateKitBody,
  CreateQuestionBody,
  DashboardAnalyticsResponse,
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

const ns = makeTestNamespace('dashboard-analytics.test');

async function createPublishedKit(test: TestApp, token: string): Promise<KitVersion> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: 'Analytics Kit', role: 'Engineer', level: 'Mid' } satisfies CreateKitBody,
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
  const qRes = await postJson(test.baseUrl, `/kits/${kit.id}/questions`, question, bearer(token));
  expect(qRes.status).toBe(201);

  const publish = await postJson(test.baseUrl, `/kits/${kit.id}/publish`, undefined, bearer(token));
  expect(publish.status).toBe(201);
  return ((await publish.json()) as { version: KitVersion }).version;
}

describe.runIf(INTEGRATION_AVAILABLE)('Dashboard analytics endpoint', () => {
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

  it('returns zeroed KPIs, an empty funnel and a full-length zero volume series', async () => {
    const res = await fetch(`${test.baseUrl}/dashboard/analytics?days=7`, {
      headers: bearer(adminToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardAnalyticsResponse;
    expect(body.days).toBe(7);
    expect(body.kpis).toEqual({
      totalCandidates: 0,
      activeJobs: 0,
      scheduled: 0,
      completed: 0,
      pendingReviews: 0,
      liveNow: 0,
    });
    expect(body.pipeline.sourced).toBe(0);
    expect(body.volume).toHaveLength(7);
    expect(body.volume[0]).toEqual({ day: expect.any(String), created: 0, completed: 0 });
  });

  it('clamps the window and counts window-scoped activity', async () => {
    const version = await createPublishedKit(test, adminToken);

    // Two candidates: one consents (session created today), then we force the
    // session to a completed state with an end timestamp inside the window.
    for (const slug of ['c1', 'c2']) {
      const invited = await postJson(
        test.baseUrl,
        '/invites',
        {
          kitVersionId: version.id,
          candidate: { name: `Analytics ${slug}`, email: ns.email(slug) },
        },
        bearer(adminToken),
      );
      expect(invited.status).toBe(201);
      const { token } = (await invited.json()) as CreateCandidateInviteResponse;
      if (slug === 'c1') {
        const consent = await postJson(test.baseUrl, `/invites/by-token/${token}/consent`, {
          name: 'Analytics c1',
        });
        expect(consent.status).toBe(200);
      }
    }

    const res = await fetch(`${test.baseUrl}/dashboard/analytics?days=30`, {
      headers: bearer(adminToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardAnalyticsResponse;

    expect(body.kpis.totalCandidates).toBe(2);
    expect(body.kpis.activeJobs).toBe(1);
    // One session exists and was created inside the window.
    expect(body.kpis.scheduled).toBe(1);
    // Not ended yet → no completed counts.
    expect(body.kpis.completed).toBe(0);
    expect(body.volume).toHaveLength(30);
    const today = new Date().toISOString().slice(0, 10);
    const todayBucket = body.volume.find((v) => v.day === today);
    expect(todayBucket?.created).toBe(1);

    // Invalid values fall back to 30; the window clamps at 90.
    const bad = await fetch(`${test.baseUrl}/dashboard/analytics?days=abc`, {
      headers: bearer(adminToken),
    });
    expect(((await bad.json()) as DashboardAnalyticsResponse).days).toBe(30);
    const huge = await fetch(`${test.baseUrl}/dashboard/analytics?days=365`, {
      headers: bearer(adminToken),
    });
    expect(((await huge.json()) as DashboardAnalyticsResponse).days).toBe(90);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await fetch(`${test.baseUrl}/dashboard/analytics?days=7`);
    expect(res.status).toBe(401);
  });
});

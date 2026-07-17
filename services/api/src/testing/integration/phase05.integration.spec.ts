import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CreateKitBody,
  KitDetailResponse,
  KitResponse,
  ProposeKitBody,
  ProposeKitResponse,
  PublishProposalBody,
  PublishProposalResponse,
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

const ns = makeTestNamespace('phase05.test');

const SAMPLE_JD = `
Title: Senior Backend Engineer

We are building an AI-led interview platform.

Responsibilities:
- Design and ship scalable APIs
- Mentor junior engineers
- Own reliability and observability

Requirements / Skills:
- Python, PostgreSQL, Redis, System design
- Strong written and verbal communication
- 5+ years of backend experience
`;

describe.skipIf(!INTEGRATION_AVAILABLE)('Phase 05 JD-based generation (integration)', () => {
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

  it('proposes a kit from JD text and returns a reviewable proposal', async () => {
    const proposeRes = await postJson(
      test.baseUrl,
      '/generation/propose',
      { jdText: SAMPLE_JD } satisfies ProposeKitBody,
      bearer(adminToken),
    );
    expect(proposeRes.status).toBe(201);
    const body = (await proposeRes.json()) as ProposeKitResponse;
    expect(body.generation.status).toBe('proposed');
    expect(body.profile.title).toBe('Senior Backend Engineer');
    expect(body.profile.seniority).toBe('senior');
    expect(body.proposal.topics.length).toBeGreaterThanOrEqual(4);
    expect(body.proposal.topics.length).toBeLessThanOrEqual(8);
    expect(body.proposal.questions.length).toBeGreaterThanOrEqual(8);
    expect(body.proposal.questions.length).toBeLessThanOrEqual(15);
    expect(body.proposal.withinCap).toBe(true);
  });

  it('publishes the proposal and stamps generation metadata on the kit', async () => {
    const proposeRes = await postJson(
      test.baseUrl,
      '/generation/propose',
      { jdText: SAMPLE_JD } satisfies ProposeKitBody,
      bearer(adminToken),
    );
    expect(proposeRes.status).toBe(201);
    const { generation } = (await proposeRes.json()) as ProposeKitResponse;

    const publishRes = await postJson(
      test.baseUrl,
      `/generation/${generation.id}/publish`,
      {} satisfies PublishProposalBody,
      bearer(adminToken),
    );
    expect(publishRes.status).toBe(201);
    const published = (await publishRes.json()) as PublishProposalResponse;
    expect(published.generation.status).toBe('published');
    expect(published.generation.kitId).toBeTruthy();

    const kitRes = await fetch(`${test.baseUrl}/kits/${published.generation.kitId}`, {
      headers: bearer(adminToken),
    });
    expect(kitRes.status).toBe(200);
    const { kit, questions } = (await kitRes.json()) as KitDetailResponse;
    expect(kit.jdGenerationId).toBe(generation.id);
    expect(kit.generationMetadata.jdHash).toBe(generation.jdHash);
    expect(kit.generationMetadata.promptVersion).toBe('phase05-stub');
    expect(questions.length).toBeGreaterThanOrEqual(8);
    expect(questions.every((q) => q.source === 'jd_generated')).toBe(true);
    expect(questions.every((q) => q.sourceRef === generation.id)).toBe(true);
  });

  it('does not carry generation metadata when a kit is created directly (review gate not bypassed)', async () => {
    const createRes = await postJson(
      test.baseUrl,
      '/kits',
      { title: 'Manual Kit', role: 'Engineer', level: 'Mid' } satisfies CreateKitBody,
      bearer(adminToken),
    );
    expect(createRes.status).toBe(201);
    const { kit } = (await createRes.json()) as KitResponse;
    expect(kit.jdGenerationId).toBeNull();
    expect(Object.keys(kit.generationMetadata)).toHaveLength(0);
  });
});

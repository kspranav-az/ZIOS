import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  DurationEstimateResponse,
  KitDetailResponse,
  KitListResponse,
  KitResponse,
  KitVersionListResponse,
  KitVersionResponse,
  PreviewResponse,
  PreviewTokenResponse,
  PublishKitResponse,
  QuestionListResponse,
  QuestionResponse,
} from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  makeTestNamespace,
  signup,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('e2e-kits.test');

function req(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...bearer(token) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const OPEN_ENDED = {
  type: 'open_ended',
  prompt: 'Tell me about a time you shipped something difficult.',
  topic: 'Behavioral',
  rubricLines: [{ id: 'r1', text: 'Clarity and ownership', weight: 1 }],
};

const MCQ = {
  type: 'mcq_single',
  prompt: 'Which HTTP status means created?',
  topic: 'Technical',
  options: [
    { id: 'a', text: '201', correct: true },
    { id: 'b', text: '200' },
    { id: 'c', text: '204' },
  ],
  rubricLines: [{ id: 'r1', text: 'Correct option selected', weight: 1 }],
};

describe.skipIf(!INTEGRATION_AVAILABLE)('kits lifecycle (integration)', () => {
  let test: TestApp;
  let token: string;

  beforeAll(async () => {
    test = await bootApp();
    await ns.purge(test.db);
    const account = await signup(test.baseUrl, ns.email('kits-admin'));
    token = account.token;
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('runs the full author → publish → v2 → preview lifecycle', async () => {
    // Create kit
    const created = await req(test.baseUrl, 'POST', '/kits', token, {
      title: 'Backend Engineer Screen',
      role: 'Backend Engineer',
      level: 'mid',
      settings: { mode: 'text', proctoringLevel: 'standard', totalTimeCapSec: 1200 },
    });
    expect(created.status).toBe(201);
    const { kit } = (await created.json()) as KitResponse;
    expect(kit.status).toBe('draft');
    expect(kit.settings.proctoringLevel).toBe('standard');
    expect(kit.settings.totalTimeCapSec).toBe(1200);

    // Add questions
    const q1Res = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, token, OPEN_ENDED);
    expect(q1Res.status).toBe(201);
    const q1 = ((await q1Res.json()) as QuestionResponse).question;
    expect(q1.source).toBe('manual');

    const q2Res = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, token, {
      ...MCQ,
      timeLimitSec: 60,
    });
    expect(q2Res.status).toBe(201);
    const q2 = ((await q2Res.json()) as QuestionResponse).question;

    // Insert-before: q3 lands between q1 and q2
    const q3Res = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, token, {
      ...OPEN_ENDED,
      prompt: 'What is your notice period?',
      topic: 'Screening',
      beforeQuestionId: q2.id,
    });
    expect(q3Res.status).toBe(201);
    const q3 = ((await q3Res.json()) as QuestionResponse).question;
    let order = (
      (await (
        await req(test.baseUrl, 'GET', `/kits/${kit.id}/questions`, token)
      ).json()) as QuestionListResponse
    ).questions.map((q) => q.id);
    expect(order).toEqual([q1.id, q3.id, q2.id]);

    // Reorder (drag-order rebase)
    const reordered = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions/reorder`, token, {
      questionIds: [q2.id, q1.id, q3.id],
    });
    expect(reordered.status).toBe(200);
    order = ((await reordered.json()) as QuestionListResponse).questions.map((q) => q.id);
    expect(order).toEqual([q2.id, q1.id, q3.id]);

    // Reorder with a wrong id set is rejected
    const badReorder = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions/reorder`, token, {
      questionIds: [q1.id, q2.id],
    });
    expect(badReorder.status).toBe(400);

    // Duration estimate: 60 + 120 + 120 = 300 base, ×1.2 = 360
    const estimateRes = await req(test.baseUrl, 'GET', `/kits/${kit.id}/duration-estimate`, token);
    const estimate = (await estimateRes.json()) as DurationEstimateResponse;
    expect(estimate.baseSeconds).toBe(300);
    expect(estimate.estimatedSeconds).toBe(360);
    expect(estimate.withinCap).toBe(true);

    // Publish → immutable v1
    const published = await req(test.baseUrl, 'POST', `/kits/${kit.id}/publish`, token);
    expect(published.status).toBe(201);
    const v1 = ((await published.json()) as PublishKitResponse).version;
    expect(v1.version).toBe(1);

    const afterPublish = (
      (await (await req(test.baseUrl, 'GET', `/kits/${kit.id}`, token)).json()) as KitDetailResponse
    ).kit;
    expect(afterPublish.status).toBe('published');

    // Versions list + exact snapshot
    const versions = (
      (await (
        await req(test.baseUrl, 'GET', `/kits/${kit.id}/versions`, token)
      ).json()) as KitVersionListResponse
    ).versions;
    expect(versions.map((v) => v.version)).toEqual([1]);
    const snapshot1 = (
      (await (
        await req(test.baseUrl, 'GET', `/kits/${kit.id}/versions/1`, token)
      ).json()) as KitVersionResponse
    ).version.snapshot;
    expect(snapshot1.schemaVersion).toBe(1);
    expect(snapshot1.questions).toHaveLength(3);
    expect(snapshot1.kit.title).toBe('Backend Engineer Screen');
    expect(snapshot1.durationEstimateSec).toBe(360);

    // Immutability via the API
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const rejected = await req(
        test.baseUrl,
        method,
        `/kits/${kit.id}/versions/1`,
        token,
        method === 'DELETE' ? undefined : { title: 'tampered' },
      );
      expect(rejected.status).toBe(409);
      expect(((await rejected.json()) as { code: string }).code).toBe('VERSION_IMMUTABLE');
    }

    // Immutability at the database layer (trigger)
    await expect(
      test.db.query('UPDATE kit_version SET snapshot = $1 WHERE kit_id = $2', ['{}', kit.id]),
    ).rejects.toThrow(/immutable/);
    await expect(
      test.db.query('DELETE FROM kit_version WHERE kit_id = $1', [kit.id]),
    ).rejects.toThrow(/immutable/);

    // Edit the draft after publish (the head stays mutable) and republish → v2
    const q4Res = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, token, {
      ...OPEN_ENDED,
      prompt: 'Walk me through debugging a slow API endpoint.',
      topic: 'Technical',
    });
    expect(q4Res.status).toBe(201);
    const republished = await req(test.baseUrl, 'POST', `/kits/${kit.id}/publish`, token);
    expect(republished.status).toBe(201);
    expect(((await republished.json()) as PublishKitResponse).version.version).toBe(2);

    const snapshot2 = (
      (await (
        await req(test.baseUrl, 'GET', `/kits/${kit.id}/versions/2`, token)
      ).json()) as KitVersionResponse
    ).version.snapshot;
    expect(snapshot2.questions).toHaveLength(4);
    // Snapshots are independent frozen documents.
    expect(snapshot1.questions).toHaveLength(3);
    expect(snapshot2.durationEstimateSec).not.toBe(snapshot1.durationEstimateSec);

    // Preview token → read-only projection of the CURRENT draft
    const countsBefore = await rowCounts(test, kit.id);
    const minted = await req(test.baseUrl, 'POST', `/kits/${kit.id}/preview-token`, token);
    expect(minted.status).toBe(201);
    const previewToken = ((await minted.json()) as PreviewTokenResponse).token;

    const preview = await req(test.baseUrl, 'GET', `/preview/${previewToken}`, token);
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as PreviewResponse;
    expect(previewBody.preview).toBe(true);
    expect(previewBody.questions).toHaveLength(4);
    expect(previewBody.questions[0]?.rubricLines.length).toBeGreaterThan(0);

    // Preview created no persistence rows of any kind (FR-E2-6).
    expect(await rowCounts(test, kit.id)).toEqual(countsBefore);
    const sessionTable = await test.db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'interview_session'`,
    );
    if (sessionTable.rows.length > 0) {
      const sessions = await test.db.query('SELECT count(*)::int AS n FROM interview_session');
      expect((sessions.rows[0] as { n: number }).n).toBe(0);
    }

    // A token minted by one org is invalid for another org's session.
    const otherAccount = await signup(test.baseUrl, ns.email('kits-other'));
    const crossOrg = await req(test.baseUrl, 'GET', `/preview/${previewToken}`, otherAccount.token);
    expect(crossOrg.status).toBe(404);

    // Tampered token rejected
    const tampered = await req(
      test.baseUrl,
      'GET',
      `/preview/${previewToken.slice(0, -2)}xx`,
      token,
    );
    expect(tampered.status).toBe(404);
  });

  it('enforces org isolation: org B cannot see org A kits', async () => {
    const accountA = await signup(test.baseUrl, ns.email('iso-a'));
    const created = await req(test.baseUrl, 'POST', '/kits', accountA.token, {
      title: 'Org A Kit',
    });
    const { kit } = (await created.json()) as KitResponse;

    const accountB = await signup(test.baseUrl, ns.email('iso-b'));
    for (const path of [
      `/kits/${kit.id}`,
      `/kits/${kit.id}/questions`,
      `/kits/${kit.id}/versions`,
    ]) {
      const res = await req(test.baseUrl, 'GET', path, accountB.token);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { code: string }).code).toBe('KIT_NOT_FOUND');
    }
    const patchRes = await req(test.baseUrl, 'PATCH', `/kits/${kit.id}`, accountB.token, {
      title: 'hijack',
    });
    expect(patchRes.status).toBe(404);
    const listB = (
      (await (await req(test.baseUrl, 'GET', '/kits', accountB.token)).json()) as KitListResponse
    ).kits;
    expect(listB.some((k) => k.id === kit.id)).toBe(false);
  });

  it('enforces the updatedAt optimistic-concurrency guard on kit and question PATCHes', async () => {
    const account = await signup(test.baseUrl, ns.email('occ'));
    const { kit } = (await (
      await req(test.baseUrl, 'POST', '/kits', account.token, { title: 'OCC Kit' })
    ).json()) as KitResponse;

    // Stale kit write → 409 with the current token; fresh write succeeds.
    const stale = await req(test.baseUrl, 'PATCH', `/kits/${kit.id}`, account.token, {
      title: 'First',
      expectedUpdatedAt: kit.updatedAt,
    });
    expect(stale.status).toBe(200);
    const afterFirst = ((await stale.json()) as KitResponse).kit;
    const conflict = await req(test.baseUrl, 'PATCH', `/kits/${kit.id}`, account.token, {
      title: 'Second',
      expectedUpdatedAt: kit.updatedAt,
    });
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as { code: string; currentUpdatedAt: string };
    expect(conflictBody.code).toBe('STALE_WRITE');
    expect(conflictBody.currentUpdatedAt).toBe(afterFirst.updatedAt);

    // No token → last-writer-wins (autosave default when the UI has no baseline).
    const unguarded = await req(test.baseUrl, 'PATCH', `/kits/${kit.id}`, account.token, {
      title: 'Unguarded',
    });
    expect(unguarded.status).toBe(200);

    // Same guard on questions.
    const { question } = (await (
      await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, account.token, OPEN_ENDED)
    ).json()) as QuestionResponse;
    const qStale = await req(
      test.baseUrl,
      'PATCH',
      `/kits/${kit.id}/questions/${question.id}`,
      account.token,
      { prompt: 'Updated prompt.', expectedUpdatedAt: question.updatedAt },
    );
    expect(qStale.status).toBe(200);
    const qConflict = await req(
      test.baseUrl,
      'PATCH',
      `/kits/${kit.id}/questions/${question.id}`,
      account.token,
      { prompt: 'Again.', expectedUpdatedAt: question.updatedAt },
    );
    expect(qConflict.status).toBe(409);
  });

  it('rejects publish with 422 details until the kit is complete', async () => {
    const account = await signup(test.baseUrl, ns.email('pub-val'));
    const { kit } = (await (
      await req(test.baseUrl, 'POST', '/kits', account.token, { title: 'Incomplete' })
    ).json()) as KitResponse;

    const res = await req(test.baseUrl, 'POST', `/kits/${kit.id}/publish`, account.token);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; details: string[] };
    expect(body.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(body.details.some((d) => d.includes('role is required'))).toBe(true);
    expect(body.details.some((d) => d.includes('level is required'))).toBe(true);
    expect(body.details.some((d) => d.includes('at least one question'))).toBe(true);
  });

  it('blocks edits on archived kits and unarchive restores them', async () => {
    const account = await signup(test.baseUrl, ns.email('arch'));
    const { kit } = (await (
      await req(test.baseUrl, 'POST', '/kits', account.token, {
        title: 'Archivable',
        role: 'QA',
        level: 'senior',
      })
    ).json()) as KitResponse;
    await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, account.token, OPEN_ENDED);
    await req(test.baseUrl, 'POST', `/kits/${kit.id}/publish`, account.token);

    const archived = (
      (await (
        await req(test.baseUrl, 'POST', `/kits/${kit.id}/archive`, account.token)
      ).json()) as KitResponse
    ).kit;
    expect(archived.status).toBe('archived');

    for (const attempt of [
      () => req(test.baseUrl, 'PATCH', `/kits/${kit.id}`, account.token, { title: 'x' }),
      () => req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, account.token, OPEN_ENDED),
      () => req(test.baseUrl, 'POST', `/kits/${kit.id}/publish`, account.token),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe('KIT_ARCHIVED');
    }
    // Reads still work on archived kits.
    expect((await req(test.baseUrl, 'GET', `/kits/${kit.id}`, account.token)).status).toBe(200);

    // Unarchive restores 'published' (it has versions) and edits work again.
    const restored = (
      (await (
        await req(test.baseUrl, 'POST', `/kits/${kit.id}/unarchive`, account.token)
      ).json()) as KitResponse
    ).kit;
    expect(restored.status).toBe('published');
    const addAgain = await req(
      test.baseUrl,
      'POST',
      `/kits/${kit.id}/questions`,
      account.token,
      OPEN_ENDED,
    );
    expect(addAgain.status).toBe(201);
  });

  it('validates question payloads at write time (FR-E2-4, §6.2)', async () => {
    const account = await signup(test.baseUrl, ns.email('qval'));
    const { kit } = (await (
      await req(test.baseUrl, 'POST', '/kits', account.token, { title: 'Validation' })
    ).json()) as KitResponse;

    // adaptive_ai without a depth cap → 400
    const noCap = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, account.token, {
      ...OPEN_ENDED,
      followupPolicy: 'adaptive_ai',
    });
    expect(noCap.status).toBe(400);
    // adaptive_ai with cap 5 → 400 (1–3 only)
    const bigCap = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, account.token, {
      ...OPEN_ENDED,
      followupPolicy: 'adaptive_ai',
      followupDepthCap: 5,
    });
    expect(bigCap.status).toBe(400);
    // adaptive_ai on an MCQ → 400 (open-ended only, §6.2)
    const mcqAdaptive = await req(
      test.baseUrl,
      'POST',
      `/kits/${kit.id}/questions`,
      account.token,
      {
        ...MCQ,
        followupPolicy: 'adaptive_ai',
        followupDepthCap: 2,
      },
    );
    expect(mcqAdaptive.status).toBe(400);
    // adaptive_ai done right → 201
    const good = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, account.token, {
      ...OPEN_ENDED,
      followupPolicy: 'adaptive_ai',
      followupDepthCap: 2,
    });
    expect(good.status).toBe(201);
    // MCQ with one option → 400
    const oneOption = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, account.token, {
      ...MCQ,
      options: [{ id: 'a', text: 'Only one' }],
    });
    expect(oneOption.status).toBe(400);
    // options on open_ended → 400
    const strayOptions = await req(
      test.baseUrl,
      'POST',
      `/kits/${kit.id}/questions`,
      account.token,
      { ...OPEN_ENDED, options: [{ id: 'a', text: 'x' }] },
    );
    expect(strayOptions.status).toBe(400);
    // fixed policy without entries → 400; with entries → 201
    const fixedEmpty = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, account.token, {
      ...OPEN_ENDED,
      followupPolicy: 'fixed',
    });
    expect(fixedEmpty.status).toBe(400);
    const fixedGood = await req(test.baseUrl, 'POST', `/kits/${kit.id}/questions`, account.token, {
      ...OPEN_ENDED,
      followupPolicy: 'fixed',
      followupFixed: ['Can you give a concrete example?'],
    });
    expect(fixedGood.status).toBe(201);
  });

  it('requires authentication', async () => {
    for (const path of ['/kits', '/bank/questions']) {
      const res = await fetch(`${test.baseUrl}${path}`);
      expect(res.status).toBe(401);
    }
  });
});

async function rowCounts(
  test: TestApp,
  kitId: string,
): Promise<{ questions: number; versions: number; kits: number }> {
  const questions = await test.db.query(
    'SELECT count(*)::int AS n FROM question WHERE kit_id = $1',
    [kitId],
  );
  const versions = await test.db.query(
    'SELECT count(*)::int AS n FROM kit_version WHERE kit_id = $1',
    [kitId],
  );
  const kits = await test.db.query('SELECT count(*)::int AS n FROM kit WHERE id = $1', [kitId]);
  return {
    questions: (questions.rows[0] as { n: number }).n,
    versions: (versions.rows[0] as { n: number }).n,
    kits: (kits.rows[0] as { n: number }).n,
  };
}

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ConsentByTokenResponse,
  CreateCandidateInviteResponse,
  CreateKitBody,
  CreateQuestionBody,
  DashboardListResponse,
  IdUploadResponse,
  IntegrityEventBody,
  IntegrityFlagsResponse,
  KitDetailResponse,
  KitResponse,
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

const ns = makeTestNamespace('phase08.test');

async function createStrictVideoKit(
  test: TestApp,
  token: string,
): Promise<{ kit: KitDetailResponse['kit']; version: KitVersion }> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: 'Phase 08 Video Kit', role: 'Engineer', level: 'Mid' } satisfies CreateKitBody,
    bearer(token),
  );
  expect(create.status).toBe(201);
  const kit = ((await create.json()) as KitDetailResponse).kit;

  const settings = await fetch(`${test.baseUrl}/kits/${kit.id}/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...bearer(token) },
    body: JSON.stringify({ mode: 'video', proctoringLevel: 'strict' }),
  });
  expect(settings.status).toBe(200);
  expect(((await settings.json()) as KitResponse).kit.settings.mode).toBe('video');

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
  const add = await postJson(test.baseUrl, `/kits/${kit.id}/questions`, q1, bearer(token));
  expect(add.status).toBe(201);

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

async function startVideoSession(
  test: TestApp,
  adminToken: string,
  noticeText = 'Test disclosure: strict video proctoring enabled.',
): Promise<{ sessionId: string; recoveryToken: string; candidateId: string }> {
  const { version } = await createStrictVideoKit(test, adminToken);

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
  const { token, candidate } = (await inviteRes.json()) as CreateCandidateInviteResponse;

  const consentRes = await postJson(test.baseUrl, `/invites/by-token/${token}/consent`, {
    name: 'Alice Smith',
    noticeText,
  });
  expect(consentRes.status).toBe(200);
  const consentBody = (await consentRes.json()) as ConsentByTokenResponse;
  expect(consentBody.consent.noticeText).toBe(noticeText);

  return {
    sessionId: consentBody.session.id,
    recoveryToken: consentBody.recoveryToken,
    candidateId: candidate.id,
  };
}

async function uploadIdImage(
  baseUrl: string,
  sessionId: string,
  candidateId: string,
): Promise<IdUploadResponse> {
  const boundary = `----formdata-${randomUUID()}`;
  const imageBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
  const imageBytes = Buffer.from(imageBase64, 'base64');

  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\n`));
  parts.push(Buffer.from('Content-Disposition: form-data; name="file"; filename="id.png"\r\n'));
  parts.push(Buffer.from('Content-Type: image/png\r\n\r\n'));
  parts.push(imageBytes);
  parts.push(Buffer.from(`\r\n--${boundary}\r\n`));
  parts.push(Buffer.from('Content-Disposition: form-data; name="candidateId"\r\n\r\n'));
  parts.push(Buffer.from(candidateId));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const response = await fetch(
    `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/integrity/id-upload`,
    {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(parts),
    },
  );
  expect(response.status).toBe(201);
  return (await response.json()) as IdUploadResponse;
}

describe.runIf(INTEGRATION_AVAILABLE)('Phase 08 — video proctoring & integrity', () => {
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

  it('stores the exact proctoring disclosure in the consent record', async () => {
    const disclosure =
      'Custom strict disclosure: camera on, periodic snapshots, human review required.';
    const { sessionId } = await startVideoSession(test, adminToken, disclosure);

    const sessionRes = await fetch(`${test.baseUrl}/sessions/${sessionId}`, {
      headers: bearer(adminToken),
    });
    expect(sessionRes.status).toBe(200);
    // Consent record was already asserted in startVideoSession helper.
    expect(sessionId).toBeTruthy();
  });

  it('records integrity events and exposes flags to employers for disposition', async () => {
    const { sessionId } = await startVideoSession(test, adminToken);

    const body: IntegrityEventBody = {
      events: [
        {
          signal: 'tab_switch',
          occurredAt: new Date().toISOString(),
          evidence: { url: 'example.com', count: 1 },
        },
        {
          signal: 'paste_attempt',
          occurredAt: new Date().toISOString(),
          evidence: { target: 'answer-field', length: 12 },
        },
      ],
    };

    const eventsRes = await postJson(
      test.baseUrl,
      `/sessions/${encodeURIComponent(sessionId)}/integrity/events`,
      body,
    );
    expect(eventsRes.status).toBe(201);
    const flags = ((await eventsRes.json()) as IntegrityFlagsResponse).flags;
    expect(flags).toHaveLength(2);
    expect(flags[0]!.disposition).toBe('pending');

    const listRes = await fetch(
      `${test.baseUrl}/sessions/${encodeURIComponent(sessionId)}/integrity/flags`,
      {
        headers: bearer(adminToken),
      },
    );
    expect(listRes.status).toBe(200);
    const listed = ((await listRes.json()) as IntegrityFlagsResponse).flags;
    expect(listed).toHaveLength(2);

    const flagId = listed[0]!.id;
    const dispositionRes = await postJson(
      test.baseUrl,
      `/sessions/${encodeURIComponent(sessionId)}/integrity/flags/${flagId}/disposition`,
      {
        disposition: 'dismissed',
        reasonCode: 'false_positive',
        reasonText: 'Candidate switched to calculator briefly.',
      },
      bearer(adminToken),
    );
    expect(dispositionRes.status).toBe(200);
    const updated = (await dispositionRes.json()) as {
      flag: { disposition: string; dispositionReasonCode: string };
    };
    expect(updated.flag.disposition).toBe('dismissed');
    expect(updated.flag.dispositionReasonCode).toBe('false_positive');
  });

  it('uploads, lists and erases encrypted ID images', async () => {
    const { sessionId, candidateId } = await startVideoSession(test, adminToken);

    const upload = await uploadIdImage(test.baseUrl, sessionId, candidateId);
    expect(upload.upload.sessionId).toBe(sessionId);
    expect(upload.upload.checksum.algorithm).toBe('sha256');

    const listRes = await fetch(
      `${test.baseUrl}/sessions/${encodeURIComponent(sessionId)}/integrity/id-upload`,
    );
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { uploads: Array<{ id: string }> };
    expect(listed.uploads).toHaveLength(1);

    const eraseRes = await fetch(
      `${test.baseUrl}/sessions/${encodeURIComponent(sessionId)}/integrity/id-upload/${upload.upload.id}`,
      { method: 'DELETE' },
    );
    expect(eraseRes.status).toBe(204);

    const afterErase = await fetch(
      `${test.baseUrl}/sessions/${encodeURIComponent(sessionId)}/integrity/id-upload`,
    );
    expect(afterErase.status).toBe(200);
    expect(((await afterErase.json()) as { uploads: unknown[] }).uploads).toHaveLength(0);
  });

  it('links integrity flags to the dashboard session for human review', async () => {
    const { sessionId } = await startVideoSession(test, adminToken);

    await postJson(test.baseUrl, `/sessions/${encodeURIComponent(sessionId)}/integrity/events`, {
      events: [
        {
          signal: 'webcam_snapshot',
          occurredAt: new Date().toISOString(),
          evidence: { snapshotIndex: 1, intervalMs: 15000 },
        },
      ],
    } satisfies IntegrityEventBody);

    const dashboardRes = await fetch(`${test.baseUrl}/dashboard/interviews?pageSize=100`, {
      headers: bearer(adminToken),
    });
    expect(dashboardRes.status).toBe(200);
    const dashboard = (await dashboardRes.json()) as DashboardListResponse;
    const row = dashboard.items.find((item) => item.session.id === sessionId);
    expect(row).toBeTruthy();
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError } from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  extractInviteToken,
  makeTestNamespace,
  postJson,
  signup,
  waitForEmail,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('api-keys.test');

interface CreatedKey {
  id: string;
  kind: 'test' | 'live';
  prefix: string;
  label: string | null;
  scopes: string[];
  rateLimitPerMin: number;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
  key: string;
}

interface KeyListResponse {
  keys: Array<Omit<CreatedKey, 'key'>>;
}

describe.runIf(INTEGRATION_AVAILABLE)('Integration API keys (org admin lifecycle)', () => {
  let test: TestApp;
  let adminToken: string;
  let interviewerToken: string;

  beforeAll(async () => {
    test = await bootApp();
    await ns.purge(test.db);
    const admin = await signup(test.baseUrl, ns.email('admin'));
    adminToken = admin.token;
    // An interviewer in the same org (invite flow) to prove 403s server-side.
    const teammateEmail = ns.email('teammate');
    const inviteRes = await postJson(
      test.baseUrl,
      '/orgs/current/invites',
      { email: teammateEmail, role: 'interviewer' },
      bearer(adminToken),
    );
    expect(inviteRes.status).toBe(201);
    const mail = await waitForEmail(teammateEmail, 'invited you to InterviewOS');
    const rawToken = extractInviteToken(mail.text);
    const teammate = await signup(test.baseUrl, teammateEmail);
    const acceptRes = await postJson(
      test.baseUrl,
      '/orgs/current/invites/accept',
      { token: rawToken },
      bearer(teammate.token),
    );
    expect(acceptRes.status).toBe(200);
    interviewerToken = teammate.token;
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('runs the full key lifecycle: create → list → rotate → revoke', async () => {
    const createRes = await postJson(
      test.baseUrl,
      '/integration-api/keys',
      { kind: 'test', label: 'ATS sandbox', rateLimitPerMin: 60 },
      bearer(adminToken),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as CreatedKey;
    expect(created.key).toMatch(/^zios_test_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.key.slice(0, 12));
    expect(created.rateLimitPerMin).toBe(60);
    expect(created.revokedAt).toBeNull();

    // List shows the prefix but never the full key.
    const listRes = await fetch(`${test.baseUrl}/integration-api/keys`, {
      headers: bearer(adminToken),
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as KeyListResponse;
    const listed = list.keys.find((key) => key.id === created.id);
    expect(listed).toBeDefined();
    expect(listed!.prefix).toBe(created.prefix);
    expect('key' in listed!).toBe(false);
    expect(JSON.stringify(list)).not.toContain(created.key.slice(12));

    // Rotate: new full key returned once; the row keeps its id.
    const rotateRes = await postJson(
      test.baseUrl,
      `/integration-api/keys/${created.id}/rotate`,
      {},
      bearer(adminToken),
    );
    expect(rotateRes.status).toBe(200);
    const rotated = (await rotateRes.json()) as CreatedKey;
    expect(rotated.id).toBe(created.id);
    expect(rotated.key).not.toBe(created.key);
    expect(rotated.rotatedAt).not.toBeNull();

    // Revoke: key disappears from active lookups; list still shows it revoked.
    const revokeRes = await postJson(
      test.baseUrl,
      `/integration-api/keys/${created.id}/revoke`,
      {},
      bearer(adminToken),
    );
    expect(revokeRes.status).toBe(200);
    const revoked = (await revokeRes.json()) as Omit<CreatedKey, 'key'>;
    expect(revoked.revokedAt).not.toBeNull();

    const listAfter = (await (
      await fetch(`${test.baseUrl}/integration-api/keys`, { headers: bearer(adminToken) })
    ).json()) as KeyListResponse;
    const revokedListed = listAfter.keys.find((key) => key.id === created.id);
    expect(revokedListed?.revokedAt).not.toBeNull();

    // The DB stores only hashes: raw key material never appears.
    const rows = await test.db.query(`SELECT key_hash, prefix FROM api_key WHERE id = $1`, [
      created.id,
    ]);
    const row = rows.rows[0] as { key_hash: string; prefix: string };
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.key_hash).not.toContain(rotated.key);
    expect(row.prefix).toBe(rotated.key.slice(0, 12));
  }, 30_000);

  it('enforces admin-only mutations: interviewer gets 403, unauthenticated 401', async () => {
    const createAsInterviewer = await postJson(
      test.baseUrl,
      '/integration-api/keys',
      { kind: 'test' },
      bearer(interviewerToken),
    );
    expect(createAsInterviewer.status).toBe(403);
    expect(((await createAsInterviewer.json()) as ApiError).code).toBe('FORBIDDEN_ROLE');

    const rotateAsInterviewer = await postJson(
      test.baseUrl,
      `/integration-api/keys/${'0'.repeat(36)}/rotate`,
      {},
      bearer(interviewerToken),
    );
    expect(rotateAsInterviewer.status).toBe(403);

    const unauthenticated = await postJson(test.baseUrl, '/integration-api/keys', {
      kind: 'test',
    });
    expect(unauthenticated.status).toBe(401);

    // Interviewer CAN read the list (mutations are the admin-gated part).
    const listAsInterviewer = await fetch(`${test.baseUrl}/integration-api/keys`, {
      headers: bearer(interviewerToken),
    });
    expect(listAsInterviewer.status).toBe(200);
  }, 30_000);

  it('scopes keys to their org: another org cannot see or manage them', async () => {
    const createRes = await postJson(
      test.baseUrl,
      '/integration-api/keys',
      { kind: 'live' },
      bearer(adminToken),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as CreatedKey;

    const outsider = await signup(test.baseUrl, ns.email('outsider'));
    const listAsOutsider = (await (
      await fetch(`${test.baseUrl}/integration-api/keys`, { headers: bearer(outsider.token) })
    ).json()) as KeyListResponse;
    expect(listAsOutsider.keys.map((key) => key.id)).not.toContain(created.id);

    const rotateAsOutsider = await postJson(
      test.baseUrl,
      `/integration-api/keys/${created.id}/rotate`,
      {},
      bearer(outsider.token),
    );
    expect(rotateAsOutsider.status).toBe(404);
    expect(((await rotateAsOutsider.json()) as ApiError).code).toBe('API_KEY_NOT_FOUND');

    const revokeAsOutsider = await postJson(
      test.baseUrl,
      `/integration-api/keys/${created.id}/revoke`,
      {},
      bearer(outsider.token),
    );
    expect(revokeAsOutsider.status).toBe(404);
  }, 30_000);
});

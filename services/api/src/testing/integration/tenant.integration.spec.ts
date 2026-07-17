import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MembersResponse } from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  makeTestNamespace,
  signup,
  type TestApp,
} from './helpers';
import { DatabaseService, TenantContext, TenantContextMissingError } from '@/modules/database';

const ns = makeTestNamespace('e2e-tenant.test');

describe.skipIf(!INTEGRATION_AVAILABLE)('tenant context (integration)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await bootApp();
    await ns.purge(test.db);
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('fails closed: withTenant outside a request context is refused', async () => {
    const db = test.app.get(DatabaseService);
    await expect(db.withTenant(async () => 'never')).rejects.toBeInstanceOf(
      TenantContextMissingError,
    );
  });

  it('stamps app.org_id inside a tenant context (RLS-ready)', async () => {
    const db = test.app.get(DatabaseService);
    const orgId = '00000000-0000-0000-0000-000000000000';
    const seen = await TenantContext.run({ orgId, userId: 'u', role: 'admin' }, () =>
      db.withTenant(async (client) => {
        const result = await client.query(`SELECT current_setting('app.org_id', true) AS org_id`);
        return (result.rows[0] as { org_id: string }).org_id;
      }),
    );
    expect(seen).toBe(orgId);
  });

  it('populates the context on authenticated requests (member listing proves it)', async () => {
    // GET members runs through db.withTenant — it would 500 if the middleware
    // had not populated the TenantContext for this request.
    const admin = await signup(test.baseUrl, ns.email('ctx-admin'));
    const res = await fetch(`${test.baseUrl}/orgs/current/members`, {
      headers: bearer(admin.token),
    });
    expect(res.status).toBe(200);
    const roster = ((await res.json()) as MembersResponse).members;
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ email: admin.user.email, role: 'admin' });
  });

  it('unauthenticated requests get a clean 401, not a tenant-context crash', async () => {
    const res = await fetch(`${test.baseUrl}/orgs/current/members`);
    expect(res.status).toBe(401);
  });
});

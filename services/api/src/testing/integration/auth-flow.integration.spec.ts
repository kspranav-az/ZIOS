import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError, AuthResponse, MeResponse, OtpRequestResponse } from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  SPA_ORIGIN,
  bearer,
  bootApp,
  extractOtp,
  makeTestNamespace,
  postJson,
  signup,
  waitForEmail,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('e2e-auth.test');

describe.skipIf(!INTEGRATION_AVAILABLE)('auth flow (integration)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await bootApp();
    await ns.purge(test.db);
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('runs the full signup flow: OTP → Mailpit → verify → cookie session → me → logout', async () => {
    const email = ns.email('founder');

    const request = await postJson(test.baseUrl, '/auth/otp/request', { email });
    expect(request.status).toBe(200);
    const requestBody = (await request.json()) as OtpRequestResponse;
    expect(requestBody).toEqual({ ok: true, expiresInSeconds: 600, resendAvailableInSeconds: 60 });

    // The code actually landed in Mailpit (real SMTP through the compose stack).
    const mail = await waitForEmail(email, 'sign-in code');
    const code = extractOtp(mail.text);

    const verify = await postJson(test.baseUrl, '/auth/otp/verify', { email, code });
    expect(verify.status).toBe(200);
    const auth = (await verify.json()) as AuthResponse;
    expect(auth.isNewUser).toBe(true);
    expect(auth.session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Date(auth.session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(auth.user).toMatchObject({ email, role: 'admin' });
    expect(auth.org).toMatchObject({ name: ns.orgName, plan: 'pilot' });
    expect(auth.user.orgId).toBe(auth.org.id);

    // httpOnly session cookie is set alongside the body token.
    const setCookie = verify.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('zios_session=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    const cookie = setCookie.split(';')[0] as string;

    const meViaCookie = await fetch(`${test.baseUrl}/auth/me`, { headers: { cookie } });
    expect(meViaCookie.status).toBe(200);
    const me = (await meViaCookie.json()) as MeResponse;
    expect(me.user.id).toBe(auth.user.id);
    expect(me.org.id).toBe(auth.org.id);

    const meViaBearer = await fetch(`${test.baseUrl}/auth/me`, {
      headers: bearer(auth.session.token),
    });
    expect(meViaBearer.status).toBe(200);

    const logout = await fetch(`${test.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(logout.status).toBe(204);

    const afterLogout = await fetch(`${test.baseUrl}/auth/me`, { headers: { cookie } });
    expect(afterLogout.status).toBe(401);
    const error = (await afterLogout.json()) as ApiError;
    expect(error.code).toBe('UNAUTHENTICATED');
  });

  it('treats a returning email as a login (no second org)', async () => {
    const email = ns.email('returning');
    const first = await signup(test.baseUrl, email);

    // Skip the resend cooldown by aging this email's issued code rows.
    await test.db.query(
      `UPDATE otp_code SET created_at = now() - interval '61 seconds' WHERE email = $1`,
      [email],
    );
    const second = await signup(test.baseUrl, email);

    expect(second.org.id).toBe(first.org.id);
    expect(second.user.id).toBe(first.user.id);
    const me = await fetch(`${test.baseUrl}/auth/me`, { headers: bearer(second.token) });
    expect(((await me.json()) as MeResponse).user.role).toBe('admin');
  });

  it('enforces the 60s resend cooldown', async () => {
    const email = ns.email('cooldown');
    await postJson(test.baseUrl, '/auth/otp/request', { email });

    const second = await postJson(test.baseUrl, '/auth/otp/request', { email });

    expect(second.status).toBe(429);
    const error = (await second.json()) as ApiError & { retryAfterSeconds: number };
    expect(error.code).toBe('OTP_COOLDOWN');
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('rejects wrong codes and locks the code after 5 attempts', async () => {
    const email = ns.email('attempts');
    await postJson(test.baseUrl, '/auth/otp/request', { email });
    const mail = await waitForEmail(email, 'sign-in code');
    const realCode = extractOtp(mail.text);
    const wrongCode = realCode === '000000' ? '000001' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await postJson(test.baseUrl, '/auth/otp/verify', { email, code: wrongCode });
      expect(res.status).toBe(401);
      expect(((await res.json()) as ApiError).code).toBe('INVALID_OTP');
    }

    const locked = await postJson(test.baseUrl, '/auth/otp/verify', { email, code: wrongCode });
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as ApiError).code).toBe('OTP_ATTEMPTS_EXCEEDED');

    // …and even the right code is dead now.
    const realTry = await postJson(test.baseUrl, '/auth/otp/verify', { email, code: realCode });
    expect(realTry.status).toBe(429);
  });

  it('rejects an expired code', async () => {
    const email = ns.email('expired');
    await postJson(test.baseUrl, '/auth/otp/request', { email });
    const mail = await waitForEmail(email, 'sign-in code');
    const code = extractOtp(mail.text);
    await test.db.query(
      `UPDATE otp_code SET expires_at = now() - interval '1 second' WHERE email = $1`,
      [email],
    );

    const verify = await postJson(test.baseUrl, '/auth/otp/verify', { email, code });

    expect(verify.status).toBe(401);
    expect(((await verify.json()) as ApiError).code).toBe('OTP_EXPIRED');
  });

  it('rejects replay of an already-consumed code (single-use)', async () => {
    const email = ns.email('replay');
    await postJson(test.baseUrl, '/auth/otp/request', { email });
    const mail = await waitForEmail(email, 'sign-in code');
    const code = extractOtp(mail.text);

    const first = await postJson(test.baseUrl, '/auth/otp/verify', { email, code });
    expect(first.status).toBe(200);

    const replay = await postJson(test.baseUrl, '/auth/otp/verify', { email, code });
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as ApiError).code).toBe('INVALID_OTP');
  });

  it('supersedes the previous code when a new one is issued', async () => {
    const email = ns.email('supersede');
    await postJson(test.baseUrl, '/auth/otp/request', { email });
    const firstMail = await waitForEmail(email, 'sign-in code');
    const firstCode = extractOtp(firstMail.text);

    await test.db.query(
      `UPDATE otp_code SET created_at = now() - interval '61 seconds' WHERE email = $1`,
      [email],
    );
    await postJson(test.baseUrl, '/auth/otp/request', { email });
    const secondCode = extractOtp(
      (await waitForEmail(email, 'sign-in code', { excludeIds: [firstMail.id] })).text,
    );

    const oldTry = await postJson(test.baseUrl, '/auth/otp/verify', { email, code: firstCode });
    expect(oldTry.status).toBe(401);

    const newTry = await postJson(test.baseUrl, '/auth/otp/verify', { email, code: secondCode });
    expect(newTry.status).toBe(200);
  });

  it('401s every protected route without a session', async () => {
    for (const [method, path] of [
      ['GET', '/auth/me'],
      ['GET', '/orgs/current/members'],
      ['POST', '/orgs/current/invites'],
      ['POST', '/orgs/current/invites/accept'],
      ['POST', '/auth/logout'],
    ] as const) {
      const res = await fetch(`${test.baseUrl}${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    // …while public routes stay open.
    expect((await fetch(`${test.baseUrl}/healthz`)).status).toBe(200);
    const request = await postJson(test.baseUrl, '/auth/otp/request', {
      email: ns.email('public'),
    });
    expect(request.status).toBe(200);
  });

  it('validates input shapes', async () => {
    const badEmail = await postJson(test.baseUrl, '/auth/otp/request', { email: 'nope' });
    expect(badEmail.status).toBe(400);
    expect(((await badEmail.json()) as ApiError).code).toBe('VALIDATION_ERROR');

    const badCode = await postJson(test.baseUrl, '/auth/otp/verify', {
      email: ns.email('shapes'),
      code: '12345',
    });
    expect(badCode.status).toBe(400);
    expect(((await badCode.json()) as ApiError).code).toBe('VALIDATION_ERROR');
  });

  it('answers CORS preflight for the SPA origin with credentials', async () => {
    const res = await fetch(`${test.baseUrl}/auth/otp/request`, {
      method: 'OPTIONS',
      headers: {
        origin: SPA_ORIGIN,
        'access-control-request-method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(SPA_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });
});

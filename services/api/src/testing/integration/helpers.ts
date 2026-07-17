/**
 * Integration test harness: boots the real AppModule on an ephemeral port and
 * talks to the compose stack (Postgres + Mailpit). Suites skip themselves
 * when DATABASE_URL is absent (e.g. CI's unit-test job has no compose stack).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { AppUser, AuthResponse, Org } from '@zios/shared-types';
import { AppModule } from '@/app.module';
import { DatabaseService } from '@/modules/database';

export const INTEGRATION_AVAILABLE = Boolean(process.env.DATABASE_URL);
export const MAILPIT_API = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
export const SPA_ORIGIN = 'http://localhost:5173';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  db: DatabaseService;
}

export async function bootApp(): Promise<TestApp> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  app.enableCors({ origin: [SPA_ORIGIN], credentials: true });
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    db: app.get(DatabaseService),
  };
}

/**
 * Per-suite test-data namespace: each suite owns an email domain so parallel
 * suites never purge each other's rows. Org names derive from the domain
 * (first label, capitalized) — the same heuristic the api uses.
 */
export function makeTestNamespace(domain: string): {
  email: (tag: string) => string;
  orgName: string;
  purge: (db: DatabaseService) => Promise<void>;
} {
  const label = domain.split('.')[0] ?? domain;
  const orgName = label.charAt(0).toUpperCase() + label.slice(1);
  return {
    orgName,
    email: (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@${domain}`,
    purge: async (db: DatabaseService) => {
      await db.query(`DELETE FROM org_invite WHERE email ILIKE $1`, [`%@${domain}`]);
      await db.query(`DELETE FROM app_user WHERE email ILIKE $1`, [`%@${domain}`]);
      await db.query(`DELETE FROM "org" WHERE name = $1`, [orgName]);
      await db.query(`DELETE FROM otp_code WHERE email ILIKE $1`, [`%@${domain}`]);
    },
  };
}

interface MailpitListMessage {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
}

interface MailpitMessageDetail {
  Subject: string;
  Text: string;
}

/** Polls Mailpit's HTTP API until the expected email arrives. */
export async function waitForEmail(
  to: string,
  subjectIncludes: string,
  options: { timeoutMs?: number; excludeIds?: string[] } = {},
): Promise<{ id: string; subject: string; text: string }> {
  const { timeoutMs = 15000, excludeIds = [] } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listRes = await fetch(`${MAILPIT_API}/api/v1/messages?limit=50`);
    const list = (await listRes.json()) as { messages?: MailpitListMessage[] };
    const hit = (list.messages ?? []).find(
      (m) =>
        !excludeIds.includes(m.ID) &&
        m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()) &&
        m.Subject.includes(subjectIncludes),
    );
    if (hit) {
      const detailRes = await fetch(`${MAILPIT_API}/api/v1/message/${hit.ID}`);
      const detail = (await detailRes.json()) as MailpitMessageDetail;
      return { id: hit.ID, subject: detail.Subject, text: detail.Text ?? '' };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no email to ${to} with subject containing "${subjectIncludes}" arrived`);
}

export function extractOtp(text: string): string {
  const match = /(\d{6})/.exec(text);
  if (!match?.[1]) {
    throw new Error(`no 6-digit code found in email text:\n${text}`);
  }
  return match[1];
}

export function extractInviteToken(text: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) {
    throw new Error(`no invite token found in email text:\n${text}`);
  }
  return match[1];
}

export async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Full signup: OTP request → code read from Mailpit → verify. */
export async function signup(
  baseUrl: string,
  email: string,
): Promise<{ token: string; user: AppUser; org: Org; setCookie: string | null }> {
  const request = await postJson(baseUrl, '/auth/otp/request', { email });
  if (!request.ok) {
    throw new Error(`otp request failed: ${request.status} ${await request.text()}`);
  }
  const mail = await waitForEmail(email, 'sign-in code');
  const code = extractOtp(mail.text);
  const verify = await postJson(baseUrl, '/auth/otp/verify', { email, code });
  if (!verify.ok) {
    throw new Error(`otp verify failed: ${verify.status} ${await verify.text()}`);
  }
  const body = (await verify.json()) as AuthResponse;
  return {
    token: body.session.token,
    user: body.user,
    org: body.org,
    setCookie: verify.headers.get('set-cookie'),
  };
}

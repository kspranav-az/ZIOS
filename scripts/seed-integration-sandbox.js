#!/usr/bin/env node
/**
 * Seed a partner-integration sandbox (FR-E13-5 validation helper).
 *
 * Creates a fresh org through the real signup flow (OTP via Mailpit), builds
 * and publishes a text-mode interview kit, issues a test API key, grants
 * credits, and prints the exact curl commands for the partner loop:
 *
 *   POST /v1/interviews → GET /v1/interviews/:id → GET /v1/interviews/:id/scorecard
 *
 * Usage:
 *   node scripts/seed-integration-sandbox.js [--email you@example.com]
 *
 * Prerequisites: docker compose stack up (api :3000, mailpit :8025,
 * postgres :55432). No other setup needed.
 *
 * Re-running with the same --email reuses the existing org and kit but issues
 * a FRESH api key each time (old keys stay valid until revoked).
 */

import { randomUUID } from 'node:crypto';

const API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const MAILPIT = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
const args = process.argv.slice(2);
const emailFlag = args.indexOf('--email');
const email =
  emailFlag >= 0 && args[emailFlag + 1]
    ? args[emailFlag + 1]
    : `sandbox+${Date.now()}@example.com`;

async function postJson(path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function getJson(path, headers = {}) {
  const res = await fetch(`${API}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

async function waitForOtp(to) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json();
    const hit = (list.messages ?? []).find(
      (m) => m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()) && /sign-in code/.test(m.Subject),
    );
    if (hit) {
      const detail = await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
      const match = /(\d{6})/.exec(detail.Text ?? '');
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no OTP email arrived for ${to} (mailpit at ${MAILPIT})`);
}

async function signup() {
  const request = await postJson('/auth/otp/request', { email });
  if (request.status !== 200 && request.status !== 201) {
    throw new Error(`otp request failed: ${request.status} ${JSON.stringify(request.body)}`);
  }
  const code = await waitForOtp(email);
  const verify = await postJson('/auth/otp/verify', { email, code });
  if (verify.status !== 200 && verify.status !== 201) {
    // Known quirk: the very first OTP for a brand-new email can be rejected;
    // the flow re-requests and the second code works.
    const retry = await postJson('/auth/otp/request', { email });
    if (!retry.ok) throw new Error(`otp resend failed: ${retry.status}`);
    const second = await waitForOtp(email);
    const secondVerify = await postJson('/auth/otp/verify', { email, code: second });
    if (secondVerify.status !== 200 && secondVerify.status !== 201) {
      throw new Error(`otp verify failed: ${secondVerify.status} ${JSON.stringify(secondVerify.body)}`);
    }
    return secondVerify.body.session.token;
  }
  return verify.body.session.token;
}

async function ensurePublishedKit(auth) {
  const existing = await getJson('/kits', auth);
  const reusable = (existing.body.kits ?? []).find((kit) => kit.title === 'Sandbox Interview Kit');
  if (reusable && reusable.status === 'published') {
    return reusable;
  }

  const created = await postJson(
    '/kits',
    { title: 'Sandbox Interview Kit', role: 'Software Engineer', level: 'Mid' },
    auth,
  );
  if (created.status !== 201) throw new Error(`kit create failed: ${JSON.stringify(created.body)}`);
  const kit = created.body.kit;

  const questions = [
    {
      type: 'open_ended',
      prompt: 'Tell us about a project you are proud of and your specific contribution.',
      topic: 'Experience',
      timeLimitSec: 120,
      timeLimitType: 'soft',
      mandatory: true,
      followupPolicy: 'none',
      rubricLines: [{ id: randomUUID(), text: 'Specificity', weight: 1 }],
    },
    {
      type: 'open_ended',
      prompt: 'Describe a time you disagreed with a teammate and how it was resolved.',
      topic: 'Collaboration',
      timeLimitSec: 120,
      timeLimitType: 'soft',
      mandatory: true,
      followupPolicy: 'none',
      rubricLines: [{ id: randomUUID(), text: 'Communication', weight: 1 }],
    },
  ];
  for (const question of questions) {
    const add = await postJson(`/kits/${kit.id}/questions`, question, auth);
    if (add.status !== 201) throw new Error(`question add failed: ${JSON.stringify(add.body)}`);
  }
  const publish = await postJson(`/kits/${kit.id}/publish`, undefined, auth);
  if (publish.status !== 201) throw new Error(`publish failed: ${JSON.stringify(publish.body)}`);
  kit.status = 'published';
  return kit;
}

async function main() {
  console.log(`\n🌱 Seeding integration sandbox for ${email}\n`);
  const token = await signup();
  const auth = { authorization: `Bearer ${token}` };

  const kit = await ensurePublishedKit(auth);

  const keyRes = await postJson('/integration-api/keys', { kind: 'test', label: 'sandbox' }, auth);
  if (keyRes.status !== 201) throw new Error(`api key create failed: ${JSON.stringify(keyRes.body)}`);
  const apiKey = keyRes.body.key;

  const me = await getJson('/auth/me', auth);
  const orgId = me.body.org.id;

  // Credits for wallet/debits (grant path; Branch 4 adds the admin tool).
  const { withClient } = await import('./lib/local-db-client.js');
  const dbUrl =
    process.env.DATABASE_URL ?? 'postgresql://interviewos:interviewos_dev@localhost:55432/interviewos';
  process.env.DATABASE_URL = dbUrl;
  await withClient(async (client) => {
    await client.query('UPDATE org SET credits_balance = 500 WHERE id = $1', [orgId]);
  });

  const sample = JSON.stringify(
    {
      kit_id: kit.id,
      mode: 'text',
      candidate: {
        name: 'Ada Lovelace',
        email: 'ada@partner-candidate.example',
        external_ref: 'candidate-001',
      },
    },
    null,
    2,
  );

  console.log('✅ Sandbox ready.\n');
  console.log('──────────────────────────────────────────────────────────────────');
  console.log(`API key (shown once — store it now):\n  ${apiKey}`);
  console.log(`Published kit id:\n  ${kit.id}`);
  console.log('──────────────────────────────────────────────────────────────────\n');
  console.log('1) Create an interview (idempotent per external_ref):');
  console.log(
    `  curl -X POST ${API}/v1/interviews -H "Authorization: Bearer ${apiKey}" \\\n    -H "Content-Type: application/json" -d '${sample}'`,
  );
  console.log('\n2) Poll status (use interview_id from step 1):');
  console.log(`  curl ${API}/v1/interviews/<interview_id> -H "Authorization: Bearer ${apiKey}"`);
  console.log('\n3) Fetch the scorecard once the interview is completed:');
  console.log(
    `  curl ${API}/v1/interviews/<interview_id>/scorecard -H "Authorization: Bearer ${apiKey}"`,
  );
  console.log('\nCandidate invite links from step 1 can be opened directly in the browser.');
}

main().catch((err) => {
  console.error('❌ Sandbox seed failed:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Live end-to-end verification: seed a text interview, drive it to completion,
 * wait for evaluation, and inspect the evidence-linked report.
 *
 *   node scripts/verify-live-e2e.js
 *
 * Exercises: OTP auth, kit CRUD + publish, invites, consent, preflight,
 * turn loop (open/mcq_single/mcq_multi/rating), wrap-up, async evaluation,
 * report with cited evidence spans. Exits non-zero on any failed assertion.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '..', '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const MAILPIT_API = process.env.MAILPIT_API ?? 'http://localhost:8025';

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function extractOtp(text) {
  const match = /(\d{6})/.exec(text);
  if (!match?.[1]) throw new Error('no 6-digit OTP found in email');
  return match[1];
}

async function waitForEmail(to, subjectIncludes, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listRes = await fetch(`${MAILPIT_API}/api/v1/messages?limit=50`);
    const list = (await listRes.json()) ?? {};
    const hit = (list.messages ?? []).find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()) &&
        m.Subject.includes(subjectIncludes),
    );
    if (hit) {
      const detailRes = await fetch(`${MAILPIT_API}/api/v1/message/${hit.ID}`);
      const detail = (await detailRes.json()) ?? {};
      return { id: hit.ID, text: detail.Text ?? '' };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no email to ${to} with subject "${subjectIncludes}" arrived`);
}

async function api(method, pathName, { body, token, recovery } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (recovery) headers['x-recovery-token'] = recovery;
  const res = await fetch(`${API_BASE}${pathName}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

async function postOk(pathName, body, opts = {}) {
  const r = await api('POST', pathName, { body, ...opts });
  if (r.status >= 400) throw new Error(`POST ${pathName} → ${r.status}: ${r.text.slice(0, 300)}`);
  return r.json;
}

async function main() {
  const tag = randomUUID().slice(0, 8);
  const adminEmail = `e2e-admin-${tag}@local.test`;
  const candidateEmail = `e2e-candidate-${tag}@local.test`;

  console.log('\n■ 1. Employer OTP sign-in (Mailpit)');
  await postOk('/auth/otp/request', { email: adminEmail });
  let mail = await waitForEmail(adminEmail, 'sign-in code');
  let code = extractOtp(mail.text);
  let body = await postOk('/auth/otp/verify', { email: adminEmail, code });
  // Known quirk: very first OTP can be rejected — resend once if needed.
  if (!body?.session?.token) {
    await postOk('/auth/otp/request', { email: adminEmail });
    mail = await waitForEmail(adminEmail, 'sign-in code');
    code = extractOtp(mail.text);
    body = await postOk('/auth/otp/verify', { email: adminEmail, code });
  }
  const adminToken = body.session.token;
  check('admin session issued', !!adminToken);
  check('new org auto-provisioned', body.isNewUser === true);

  console.log('\n■ 2. Kit builder: create → 4 questions → publish');
  const { kit } = await postOk(
    '/kits',
    {
      title: `E2E Live Kit ${tag}`,
      role: 'Software Engineer',
      level: 'Mid',
      settings: { mode: 'text', proctoringLevel: 'none' },
    },
    { token: adminToken },
  );
  check('kit created', !!kit?.id);

  const mcqSingleCorrect = randomUUID();
  const mcqMultiA = randomUUID();
  const mcqMultiB = randomUUID();
  const questions = [
    {
      type: 'open_ended',
      prompt: 'Tell us about a challenging project you led.',
      topic: 'Experience',
      timeLimitSec: 120,
      timeLimitType: 'soft',
      mandatory: true,
      followupPolicy: 'none',
      rubricLines: [{ id: randomUUID(), text: 'Clarity', weight: 1 }],
    },
    {
      type: 'mcq_single',
      prompt: 'Which HTTP method is idempotent?',
      topic: 'Technical',
      timeLimitSec: 60,
      timeLimitType: 'soft',
      mandatory: true,
      followupPolicy: 'none',
      options: [
        { id: mcqSingleCorrect, text: 'PUT', correct: true },
        { id: randomUUID(), text: 'POST', correct: false },
        { id: randomUUID(), text: 'PATCH', correct: false },
      ],
      rubricLines: [{ id: randomUUID(), text: 'Accuracy', weight: 1 }],
    },
    {
      type: 'mcq_multi',
      prompt: 'Select all that are JavaScript primitive types.',
      topic: 'Technical',
      timeLimitSec: 60,
      timeLimitType: 'soft',
      mandatory: true,
      followupPolicy: 'none',
      options: [
        { id: mcqMultiA, text: 'string', correct: true },
        { id: mcqMultiB, text: 'number', correct: true },
        { id: randomUUID(), text: 'array', correct: false },
        { id: randomUUID(), text: 'object', correct: false },
      ],
      rubricLines: [{ id: randomUUID(), text: 'Accuracy', weight: 1 }],
    },
    {
      type: 'rating_scale',
      prompt: 'Rate your confidence with React hooks (1-5).',
      topic: 'Self-assessment',
      timeLimitSec: 60,
      timeLimitType: 'soft',
      mandatory: true,
      followupPolicy: 'none',
      rubricLines: [{ id: randomUUID(), text: 'Honesty', weight: 1 }],
    },
  ];
  for (const q of questions) {
    await postOk(`/kits/${kit.id}/questions`, q, { token: adminToken });
  }
  const { version } = await postOk(`/kits/${kit.id}/publish`, undefined, { token: adminToken });
  check('kit published, immutable version', !!version?.id && version?.version >= 1);

  console.log('\n■ 3. Invite + consent (stored before capture)');
  const { token: inviteToken } = await postOk(
    '/invites',
    {
      kitVersionId: version.id,
      candidate: { name: 'E2E Candidate', email: candidateEmail },
      conductor: 'ai',
    },
    { token: adminToken },
  );
  check('token-bound invite created', !!inviteToken);
  const consent = await postOk(`/invites/by-token/${encodeURIComponent(inviteToken)}/consent`, {
    name: 'E2E Candidate',
    email: candidateEmail,
  });
  const sessionId = consent.session?.id;
  const recovery = consent.recoveryToken;
  check('consent recorded → session', !!sessionId);
  check('recovery token issued', !!recovery);
  check('session starts in consented state', consent.session?.status === 'consented');

  console.log('\n■ 4. Interview turn loop (preflight → 4 turns → wrap-up)');
  const pre = await postOk(`/sessions/${sessionId}/preflight`, {}, { recovery });
  check('preflight returns first question', pre.turn?.type === 'question' && !!pre.turn.text);
  check('start debited → session live', pre.session?.status === 'live');

  const turns = [];
  let current = pre;
  const answers = [
    { answer: 'I led a migration of our monolith to event-driven services, coordinating six engineers across two teams and delivering three weeks early.' },
    { answerData: { type: 'mcq_single', selectedOptionIds: [mcqSingleCorrect] } },
    { answerData: { type: 'mcq_multi', selectedOptionIds: [mcqMultiA, mcqMultiB] } },
    { answerData: { type: 'rating_scale', rating: 4 } },
  ];
  for (let i = 0; i < answers.length; i += 1) {
    const r = await postOk(`/sessions/${sessionId}/turn`, answers[i], { recovery });
    turns.push(r.turn);
    current = r;
  }
  check('turn 4 returns wrap-up', current.turn?.type === 'wrapup', JSON.stringify(current.turn).slice(0, 120));
  check('session completed', current.session?.status === 'completed');

  console.log('\n■ 5. Async evaluation → report');
  const deadline = Date.now() + 180_000;
  let reportRes = { status: 404, json: {} };
  while (Date.now() < deadline) {
    reportRes = await api('GET', `/reports/${sessionId}`, { token: adminToken });
    const scores = reportRes.json?.scores ?? [];
    if (reportRes.status === 200 && scores.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  check('evaluation finished → report available', reportRes.status === 200);

  const report = reportRes.json ?? {};
  const scores = report.scores ?? [];
  check('rubric scores present (>= 4 criteria)', scores.length >= 4, `got ${scores.length}`);
  const evidenceSpans = report.evidenceSpans ?? [];
  const withEvidence = scores.filter(
    (s) => Array.isArray(s.evidenceSpanIds) && s.evidenceSpanIds.length > 0,
  );
  check(
    'every score cites transcript evidence',
    scores.length > 0 && withEvidence.length === scores.length && evidenceSpans.length >= scores.length,
    `${withEvidence.length}/${scores.length} scores, ${evidenceSpans.length} spans`,
  );
  const transcript = report.transcript ?? [];
  check('transcript present', transcript.length >= 4, `got ${transcript.length}`);

  console.log(`\nsessionId: ${sessionId}`);
  console.log(`report:    http://localhost:5173/interviews/${sessionId}`);
  if (failures > 0) {
    console.log(`\n❌ ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n✅ Live end-to-end verification PASSED');
}

main().catch((err) => {
  console.error('\n❌ Verification aborted:', err.message);
  process.exit(1);
});

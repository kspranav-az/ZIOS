#!/usr/bin/env node
/**
 * Seed a human-facilitated interview for manual validation (Phase 09).
 *
 *   node scripts/seed-human-validation.js
 *
 * Pre-requisites:
 *   - docker compose up -d (api, mailpit, livekit, postgres running)
 *   - migrations applied (pnpm migrate)
 *
 * Creates:
 *   - one admin + org (via email OTP)
 *   - one video-mode kit with two questions and rubric lines
 *   - one human-conductor invite
 *   - candidate consent (so a session exists)
 *   - a scheduled slot starting now
 *
 * Prints the employer cockpit URL, candidate landing URL, sign-in instructions,
 * and a summary. Open the two URLs in separate browsers/incognito windows.
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

function extractOtp(text) {
  const match = /(\d{6})/.exec(text);
  if (!match?.[1]) throw new Error('no 6-digit OTP found in email');
  return match[1];
}

async function waitForEmail(to, subjectIncludes, options = {}) {
  const { timeoutMs = 15000, excludeIds = [] } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listRes = await fetch(`${MAILPIT_API}/api/v1/messages?limit=50`);
    const list = (await listRes.json()) ?? {};
    const hit = (list.messages ?? []).find(
      (m) =>
        !excludeIds.includes(m.ID) &&
        m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()) &&
        m.Subject.includes(subjectIncludes),
    );
    if (hit) {
      const detailRes = await fetch(`${MAILPIT_API}/api/v1/message/${hit.ID}`);
      const detail = (await detailRes.json()) ?? {};
      return { id: hit.ID, subject: detail.Subject, text: detail.Text ?? '' };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no email to ${to} with subject containing "${subjectIncludes}" arrived`);
}

async function postJson(path, body, headers = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return res.status === 204 ? undefined : res.json();
}

async function getJson(path, headers = {}) {
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function signupAdmin(email) {
  await postJson('/auth/otp/request', { email });
  const mail = await waitForEmail(email, 'sign-in code');
  const code = extractOtp(mail.text);
  const body = await postJson('/auth/otp/verify', { email, code });
  // The consumed seed email is deleted from Mailpit so the user does not
  // accidentally try to reuse the already-spent code when signing in manually.
  await fetch(`${MAILPIT_API}/api/v1/messages`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [mail.id] }),
  });
  return { token: body.session.token, code };
}

async function main() {
  const tag = randomUUID().slice(0, 8);
  const adminEmail = `validation-admin-${tag}@local.test`;
  const candidateEmail = `validation-candidate-${tag}@local.test`;
  const candidateName = 'Validation Candidate';

  console.log('1. Creating admin...');
  const { token: adminToken } = await signupAdmin(adminEmail);
  console.log(`   admin: ${adminEmail}`);

  console.log('2. Creating video-mode kit...');
  const { kit } = await postJson(
    '/kits',
    {
      title: 'Human Validation Kit',
      role: 'Software Engineer',
      level: 'Mid',
      settings: { mode: 'video', proctoringLevel: 'none' },
    },
    { authorization: `Bearer ${adminToken}` },
  );

  const q1 = {
    type: 'open_ended',
    prompt: 'Tell us about a time you resolved a conflict in a team.',
    topic: 'Behaviour',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [
      { id: randomUUID(), text: 'Clarity of situation and action', weight: 0.5 },
      { id: randomUUID(), text: 'Outcome and reflection', weight: 0.5 },
    ],
  };
  const q2 = {
    type: 'open_ended',
    prompt: 'How do you prioritise competing deadlines?',
    topic: 'Execution',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [
      { id: randomUUID(), text: 'Prioritisation framework', weight: 0.6 },
      { id: randomUUID(), text: 'Communication and escalation', weight: 0.4 },
    ],
  };
  for (const q of [q1, q2]) {
    await postJson(`/kits/${kit.id}/questions`, q, { authorization: `Bearer ${adminToken}` });
  }

  console.log('3. Publishing kit...');
  const { version } = await postJson(`/kits/${kit.id}/publish`, undefined, {
    authorization: `Bearer ${adminToken}`,
  });

  console.log('4. Creating human-conductor invite...');
  const { token: inviteToken } = await postJson(
    '/invites',
    {
      kitVersionId: version.id,
      candidate: { name: candidateName, email: candidateEmail },
      conductor: 'human',
    },
    { authorization: `Bearer ${adminToken}` },
  );

  console.log('5. Candidate consent...');
  const { session } = await postJson(
    `/invites/by-token/${encodeURIComponent(inviteToken)}/consent`,
    { name: candidateName, email: candidateEmail },
  );

  console.log('6. Resolving invite id for scheduling...');
  const { invite } = await getJson(`/invites/by-token/${encodeURIComponent(inviteToken)}`, {
    authorization: `Bearer ${adminToken}`,
  });

  console.log('7. Scheduling slot for now...');
  const slotAt = new Date(); // schedule for now so the ±10 min room window is open immediately
  await postJson(
    `/invites/${invite.id}/schedule`,
    {
      slotAt: slotAt.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      interviewerIds: [],
    },
    { authorization: `Bearer ${adminToken}` },
  );

  const employerCockpit = `http://localhost:5173/interviews/${session.id}/cockpit`;
  const candidateLanding = `http://localhost:5174/?token=${encodeURIComponent(inviteToken)}`;
  const employerReport = `http://localhost:5173/interviews/${session.id}`;
  const employerScorecard = `http://localhost:5173/interviews/${session.id}/scorecard`;

  console.log('\n✅ Human-facilitated interview seeded.\n');
  console.log('Admin sign-in:');
  console.log(`  email:    ${adminEmail}`);
  console.log('  password: request a fresh OTP on the login page; read it from');
  console.log('            http://localhost:8025 (Mailpit) or enter the code shown there.');
  console.log('');
  console.log('URLs to open:');
  console.log(`  1. Employer cockpit (Chrome tab A):        ${employerCockpit}`);
  console.log(`  2. Candidate invite landing (Chrome tab B): ${candidateLanding}`);
  console.log('');
  console.log('After you end the call, the scorecard URL will be:');
  console.log(`  ${employerScorecard}`);
  console.log('After scoring, the report URL will be:');
  console.log(`  ${employerReport}`);
  console.log('');
  console.log('Suggested validation flow:');
  console.log('  a. Sign in to the employer cockpit (request OTP, read from Mailpit).');
  console.log('  b. Confirm kit questions + timers render.');
  console.log(
    '  c. Open candidate landing in another tab, accept consent, click Start on preflight.',
  );
  console.log('  d. Confirm video/audio connects in the LiveKit room.');
  console.log('  e. In cockpit, mark question 1 Covered, question 2 Skipped.');
  console.log('  f. Click End call → should redirect to scorecard.');
  console.log('  g. Generate AI pre-fill, edit one score, submit.');
  console.log('  h. View report and confirm human scores + evidence render.');
  console.log('');
  console.log(`sessionId: ${session.id}`);
  console.log(`inviteId:  ${invite.id}`);
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});

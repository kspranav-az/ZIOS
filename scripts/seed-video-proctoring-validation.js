#!/usr/bin/env node
/**
 * Seed an AI-led strict video interview with proctoring for manual validation.
 *
 *   node scripts/seed-video-proctoring-validation.js
 *
 * Pre-requisites:
 *   - docker compose up -d (api, mailpit, postgres running)
 *   - migrations applied (pnpm migrate)
 *
 * Creates:
 *   - one admin + org (via email OTP)
 *   - one strict video-mode kit with one question
 *   - one ai-conductor invite
 *   - candidate consent (so a session exists)
 *
 * Prints the candidate landing URL and employer report URL.
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
const cloudflareEnvFile = path.join(__dirname, '..', 'cloudflare.env');
const networkEnvFile = path.join(__dirname, '..', 'network.env');
if (existsSync(cloudflareEnvFile)) {
  process.loadEnvFile(cloudflareEnvFile);
} else if (existsSync(networkEnvFile)) {
  process.loadEnvFile(networkEnvFile);
}

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const MAILPIT_API = process.env.MAILPIT_API ?? 'http://localhost:8025';
const EMPLOYER_WEB_BASE_URL = process.env.EMPLOYER_WEB_BASE_URL ?? 'http://localhost:5173';
const CANDIDATE_WEB_BASE_URL = process.env.CANDIDATE_WEB_BASE_URL ?? 'http://localhost:5174';

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

async function signupAdmin(email) {
  await postJson('/auth/otp/request', { email });
  const mail = await waitForEmail(email, 'sign-in code');
  const code = extractOtp(mail.text);
  const body = await postJson('/auth/otp/verify', { email, code });
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
  const candidateName = 'Video Proctoring Candidate';

  console.log('1. Creating admin...');
  const { token: adminToken } = await signupAdmin(adminEmail);
  console.log(`   admin: ${adminEmail}`);

  console.log('2. Creating strict video-mode kit...');
  const { kit } = await postJson(
    '/kits',
    {
      title: 'Video Proctoring Validation Kit',
      role: 'Software Engineer',
      level: 'Mid',
      settings: { mode: 'video', proctoringLevel: 'strict' },
    },
    { authorization: `Bearer ${adminToken}` },
  );

  const q1 = {
    type: 'open_ended',
    prompt: 'Tell us about a time you had to debug a production incident under pressure.',
    topic: 'Behaviour',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [
      { id: randomUUID(), text: 'Clarity of situation', weight: 0.5 },
      { id: randomUUID(), text: 'Action and outcome', weight: 0.5 },
    ],
  };
  await postJson(`/kits/${kit.id}/questions`, q1, { authorization: `Bearer ${adminToken}` });

  console.log('3. Publishing kit...');
  const { version } = await postJson(`/kits/${kit.id}/publish`, undefined, {
    authorization: `Bearer ${adminToken}`,
  });

  console.log('4. Creating ai-conductor invite...');
  const { token: inviteToken } = await postJson(
    '/invites',
    {
      kitVersionId: version.id,
      candidate: { name: candidateName, email: candidateEmail },
      conductor: 'ai',
    },
    { authorization: `Bearer ${adminToken}` },
  );

  console.log('5. Candidate consent...');
  const { session } = await postJson(
    `/invites/by-token/${encodeURIComponent(inviteToken)}/consent`,
    { name: candidateName, email: candidateEmail },
  );

  const candidateLanding = `${CANDIDATE_WEB_BASE_URL}/?token=${encodeURIComponent(inviteToken)}`;
  const employerReport = `${EMPLOYER_WEB_BASE_URL}/interviews/${session.id}`;

  console.log('\n✅ Video proctoring interview seeded.\n');
  console.log('Admin sign-in:');
  console.log(`  email:    ${adminEmail}`);
  console.log('  password: request a fresh OTP on the login page; read it from');
  console.log(`            ${MAILPIT_API} (Mailpit) or enter the code shown there.`);
  console.log('');
  console.log('URLs to open:');
  console.log(`  1. Candidate invite landing: ${candidateLanding}`);
  console.log(`  2. Employer report:          ${employerReport}`);
  console.log('');
  console.log('Suggested validation flow:');
  console.log('  a. Open candidate landing, accept consent, start interview.');
  console.log('  b. Confirm the strict proctoring disclosure is shown.');
  console.log('  c. Allow camera/microphone and verify the video room loads.');
  console.log('  d. Switch to text fallback and answer the question.');
  console.log('  e. Trigger integrity events from the browser console if desired:');
  console.log('       document.dispatchEvent(new Event("visibilitychange"));');
  console.log('       document.dispatchEvent(new Event("paste"));');
  console.log('  f. Complete the interview and wait for the report.');
  console.log('  g. Open the employer report and confirm:');
  console.log('       - Integrity flags panel lists the triggered signals.');
  console.log('       - Each flag has evidence (tab URL, paste target, snapshot metadata).');
  console.log('       - You can disposition a flag without auto-rejecting the candidate.');
  console.log('');
  console.log(`sessionId: ${session.id}`);
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Seed an async video interview for manual validation.
 *
 *   node scripts/seed-async-video-validation.js
 *
 * Pre-requisites:
 *   - docker compose up -d (api, ai-orchestrator, postgres, minio, frontends running)
 *   - migrations applied (pnpm migrate)
 *
 * Creates:
 *   - one admin + org (via email OTP)
 *   - two role-based questions for a synthetic role
 *   - one async video interview invite (transcription enabled, 180s per question)
 *   - candidate consent + a fake video upload for the first question
 *
 * Prints the employer review URL and candidate landing URL.
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

import { query as dbQuery } from './lib/local-db-client.js';

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

async function seedRoleQuestions(roleId, roleName) {
  const values = [
    [
      randomUUID(),
      roleId,
      roleName,
      1,
      'medium',
      'Project-Based Experience Validation',
      'Tell us about a time you led a project under pressure.',
      '1-2 years',
    ],
    [
      randomUUID(),
      roleId,
      roleName,
      2,
      'medium',
      'Problem Solving',
      'How do you debug a production issue you cannot reproduce locally?',
      '1-2 years',
    ],
  ];
  for (const row of values) {
    await dbQuery(
      `INSERT INTO role_based_questions
       (id, role_id, role_name, question_number, difficulty_level, question_type, question_text, experience_target)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      row,
    );
  }
}

async function uploadFakeVideo(sessionId, questionId, recoveryToken) {
  const bytes = Buffer.from('fake-webm-video-bytes-for-validation');
  const blob = new Blob([bytes], { type: 'video/webm' });
  const form = new FormData();
  form.append('video', blob, 'answer.webm');
  form.append('durationSec', '45');

  const res = await fetch(
    `${API_BASE}/async-video-interviews/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/video`,
    {
      method: 'POST',
      headers: { 'x-recovery-token': recoveryToken },
      body: form,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`video upload failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  const tag = randomUUID().slice(0, 8);
  const adminEmail = `validation-admin-${tag}@local.test`;
  const candidateEmail = `validation-candidate-${tag}@local.test`;
  const candidateName = 'Validation Candidate';
  const roleId = Math.floor(Math.random() * 1_000_000);
  const roleName = `Async Validation Role ${tag}`;

  console.log('1. Creating admin...');
  const { token: adminToken } = await signupAdmin(adminEmail);
  console.log(`   admin: ${adminEmail}`);

  console.log('2. Seeding role-based questions...');
  await seedRoleQuestions(roleId, roleName);
  console.log(`   role: ${roleName} (id: ${roleId})`);

  console.log('3. Creating async video interview...');
  const created = await postJson(
    '/async-video-interviews',
    {
      roleId,
      candidate: { name: candidateName, email: candidateEmail },
      enableTranscription: true,
      maxDurationSec: 180,
    },
    { authorization: `Bearer ${adminToken}` },
  );
  console.log(`   sessionId: ${created.sessionId}`);
  console.log(`   inviteId:  ${created.inviteId}`);

  console.log('4. Candidate consent...');
  const consent = await postJson(
    `/async-video-interviews/by-token/${encodeURIComponent(created.token)}/consent`,
    {
      name: candidateName,
      email: candidateEmail,
    },
  );
  console.log(`   session status: ${consent.session.status}`);

  console.log('5. Uploading fake video answer for question 1...');
  const q1 = created.questions[0];
  const upload = await uploadFakeVideo(created.sessionId, q1.id, consent.recoveryToken);
  console.log(`   recordingUri: ${upload.recordingUri}`);
  console.log(`   transcript:   ${upload.transcript ? 'generated' : 'none'}`);

  const employerReviewUrl = `${EMPLOYER_WEB_BASE_URL}/interviews/${created.sessionId}/async-review`;
  const candidateLandingUrl = `${CANDIDATE_WEB_BASE_URL}/?token=${encodeURIComponent(created.token)}`;

  console.log('\n✅ Async video interview seeded.\n');
  console.log('URLs to open:');
  console.log(`  1. Employer review (Chrome tab A): ${employerReviewUrl}`);
  console.log(`  2. Candidate landing (Chrome tab B): ${candidateLandingUrl}`);
  console.log('');
  console.log('Suggested validation flow:');
  console.log('  a. Sign in to the employer review page (request OTP, read from Mailpit).');
  console.log('  b. Confirm the candidate name, question list, and uploaded video render.');
  console.log('  c. Play the video and confirm the transcript is shown.');
  console.log('  d. Enter a score and remarks, then submit.');
  console.log('  e. Refresh the page and confirm the score persists.');
  console.log('  f. Open the candidate landing URL, accept consent, and record a real answer.');
  console.log('  g. Return to the review page and confirm the new answer appears.');
  console.log('');
  console.log(`adminEmail:    ${adminEmail}`);
  console.log(`candidateEmail: ${candidateEmail}`);
  console.log(`roleId:        ${roleId}`);
  console.log(`sessionId:     ${created.sessionId}`);
  console.log(`inviteId:      ${created.inviteId}`);
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});

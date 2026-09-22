#!/usr/bin/env node
/**
 * Phase 14 validation: run the multimodal analysis pipeline end-to-end with
 * the real 150s test clip against the local compose stack.
 *
 *   node scripts/seed-multimodal-analysis-validation.js
 *
 * Pre-requisites:
 *   - docker compose up -d (api, ai-orchestrator, postgres, minio, redis running)
 *   - migrations applied (pnpm migrate)
 *   - ffmpeg on the host (to cut a 30s excerpt for the second question)
 *
 * Flow:
 *   1. admin + org via email OTP, 1000 credits
 *   2. two role-based questions for a synthetic role
 *   3. async video interview (analysis enabled by default) + candidate consent
 *   4. upload test_video/interview_video_clip_test.mp4 (150s) for Q1 and a
 *      30s excerpt for Q2
 *   5. poll GET /analysis/sessions/:id until both analysis jobs finish
 *   6. print per-question transcript + key features; exit non-zero on
 *      failed/DLQ'd jobs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const { query: dbQuery } = await import('./lib/local-db-client.js');

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const MAILPIT_API = process.env.MAILPIT_API ?? 'http://localhost:8025';
const SOURCE_VIDEO = path.join(repoRoot, 'test_video', 'interview_video_clip_test.mp4');
const TMP_DIR = path.join(repoRoot, 'tmp', 'multimodal-validation');
const POLL_TIMEOUT_MS = Number(process.env.ANALYSIS_POLL_TIMEOUT_MS ?? 40 * 60 * 1000);
const POLL_INTERVAL_MS = 10_000;

function extractOtp(text) {
  const match = /(\d{6})/.exec(text);
  if (!match?.[1]) throw new Error('no 6-digit OTP found in email');
  return match[1];
}

async function waitForEmail(to, subjectIncludes) {
  const deadline = Date.now() + 15000;
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
  throw new Error(`no email to ${to} with subject containing "${subjectIncludes}" arrived`);
}

async function postJson(apiPath, body, headers = {}) {
  const res = await fetch(`${API_BASE}${apiPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${apiPath} failed: ${res.status} ${text}`);
  }
  return res.status === 204 ? undefined : res.json();
}

async function getJson(apiPath, headers = {}) {
  const res = await fetch(`${API_BASE}${apiPath}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${apiPath} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function signupAdmin(email) {
  await postJson('/auth/otp/request', { email });
  const mail = await waitForEmail(email, 'sign-in code');
  const code = extractOtp(mail.text);
  const body = await postJson('/auth/otp/verify', { email, code });
  return { token: body.session.token, orgId: body.org.id };
}

async function seedRoleQuestions(roleId, roleName) {
  const rows = [
    [
      1,
      'Project-Based Experience Validation',
      'Tell us about a time you led a project under pressure.',
    ],
    [2, 'Problem Solving', 'How do you debug a production issue you cannot reproduce locally?'],
  ];
  for (const [num, type, text] of rows) {
    await dbQuery(
      `INSERT INTO role_based_questions
       (id, role_id, role_name, question_number, difficulty_level, question_type, question_text, experience_target)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), roleId, roleName, num, 'medium', type, text, '1-2 years'],
    );
  }
}

function makeExcerpt() {
  mkdirSync(TMP_DIR, { recursive: true });
  const out = path.join(TMP_DIR, 'interview_clip_30s.mp4');
  execFileSync('ffmpeg', ['-y', '-i', SOURCE_VIDEO, '-t', '30', '-c', 'copy', out]);
  return out;
}

async function uploadVideo(sessionId, questionId, recoveryToken, filePath, durationSec) {
  const bytes = readFileSync(filePath);
  const form = new FormData();
  form.append('video', new Blob([bytes], { type: 'video/mp4' }), path.basename(filePath));
  form.append('durationSec', String(durationSec));
  const res = await fetch(
    `${API_BASE}/async-video-interviews/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/video`,
    { method: 'POST', headers: { 'x-recovery-token': recoveryToken }, body: form },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`video upload for question ${questionId} failed: ${res.status} ${text}`);
  }
  return res.json();
}

function fmt(m) {
  if (!m) return 'n/a';
  const value = m.value === null || m.value === undefined ? 'null' : Number(m.value).toFixed(3);
  const flag = m.valid ? 'ok' : `INVALID(${m.reason ?? 'no reason'})`;
  return `${value} [${flag}]`;
}

function printFeatures(label, features) {
  const v = features.visual ?? {};
  const b = features.body ?? {};
  const h = features.hands ?? {};
  const s = features.speech ?? {};
  const voice = features.voice ?? {};
  const q = features.quality ?? {};
  const i = features.interaction ?? {};
  console.log(
    `\n--- ${label} (schema ${features.schema_version}, kind ${features.media_kind}) ---`,
  );
  console.log('visual:');
  console.log(`  face_visible_ratio:   ${fmt(v.face_visible_ratio)}`);
  console.log(`  camera_gaze_ratio:    ${fmt(v.camera_gaze_ratio)}`);
  console.log(`  looking_away_ratio:   ${fmt(v.looking_away_ratio)}`);
  console.log(`  head_yaw mean/std:    ${fmt(v.head_yaw_mean)} / ${fmt(v.head_yaw_std)}`);
  console.log(`  head_pitch mean/std:  ${fmt(v.head_pitch_mean)} / ${fmt(v.head_pitch_std)}`);
  console.log(`  head_roll mean/std:   ${fmt(v.head_roll_mean)} / ${fmt(v.head_roll_std)}`);
  console.log(`  head_movement:        ${fmt(v.head_movement)}`);
  console.log(`  facial_activity:      ${fmt(v.facial_activity)}`);
  console.log('body:');
  console.log(`  upright_ratio:        ${fmt(b.upright_ratio)}`);
  console.log(`  body_lean:            ${fmt(b.body_lean)}`);
  console.log(`  posture_stability:    ${fmt(b.posture_stability)}`);
  console.log(`  posture_valid:        ${fmt(b.posture_valid)}`);
  console.log('hands:');
  console.log(`  hands_visible_ratio:  ${fmt(h.hands_visible_ratio)}`);
  console.log(`  hand_movement:        ${fmt(h.hand_movement)}`);
  console.log(`  gesture_frequency:    ${fmt(h.gesture_frequency)}`);
  console.log('speech:');
  console.log(`  speaking_time:        ${fmt(s.speaking_time)}`);
  console.log(`  silence_time:         ${fmt(s.silence_time)}`);
  console.log(`  pause_count:          ${fmt(s.pause_count)}`);
  console.log(`  wpm mean/median:      ${fmt(s.wpm_mean)} / ${fmt(s.wpm_median)}`);
  console.log(`  filler_count:         ${fmt(s.filler_count)}`);
  console.log(`  fillers_per_minute:   ${fmt(s.fillers_per_minute)}`);
  console.log(`  repetition_count:     ${fmt(s.repetition_count)}`);
  console.log(`  false_start_count:    ${fmt(s.false_start_count)}`);
  console.log('voice:');
  console.log(`  pitch mean/median:    ${fmt(voice.pitch_mean)} / ${fmt(voice.pitch_median)}`);
  console.log(`  pitch_range:          ${fmt(voice.pitch_range)}`);
  console.log(`  rms mean/std:         ${fmt(voice.rms_mean)} / ${fmt(voice.rms_std)}`);
  console.log('quality:');
  console.log(`  blur_ratio:           ${fmt(q.blur_ratio)}`);
  console.log(`  resolution:           ${fmt(q.resolution)}`);
  console.log(`  fps:                  ${fmt(q.fps)}`);
  console.log(`  audio_clipped_ratio:  ${fmt(q.audio_clipped_ratio)}`);
  console.log('interaction:');
  console.log(`  talk_ratio:           ${fmt(i.talk_ratio)}`);
  console.log(`  windows aggregated:   ${(features.windows ?? []).length}`);
}

async function main() {
  if (!existsSync(SOURCE_VIDEO)) {
    throw new Error(`validation clip missing: ${SOURCE_VIDEO}`);
  }
  const tag = randomUUID().slice(0, 8);
  const adminEmail = `analysis-admin-${tag}@local.test`;
  const candidateEmail = `analysis-candidate-${tag}@local.test`;
  const candidateName = 'Analysis Validation Candidate';
  const roleId = Math.floor(Math.random() * 1_000_000);
  const roleName = `Multimodal Analysis Role ${tag}`;

  console.log('1. Creating admin + org (email OTP via Mailpit)...');
  const { token: adminToken, orgId } = await signupAdmin(adminEmail);
  await dbQuery(
    `UPDATE credit_account SET balance = balance + $1 WHERE holder_type = 'org' AND holder_id = $2`,
    [1000, orgId],
  );
  await dbQuery(
    `UPDATE org SET credits_balance = credits_balance + $1 WHERE id = $2`,
    [1000, orgId],
  );
  console.log(`   admin: ${adminEmail} (org ${orgId}, +1000 credits)`);

  console.log('2. Seeding role-based questions...');
  await seedRoleQuestions(roleId, roleName);
  console.log(`   role: ${roleName} (id: ${roleId})`);

  console.log('3. Creating async video interview (analysis enabled)...');
  const created = await postJson(
    '/async-video-interviews',
    {
      roleId,
      candidate: { name: candidateName, email: candidateEmail },
      enableTranscription: true,
      maxDurationSec: 240,
    },
    { authorization: `Bearer ${adminToken}` },
  );
  console.log(`   sessionId: ${created.sessionId}`);

  console.log('4. Candidate consent...');
  const consent = await postJson(
    `/async-video-interviews/by-token/${encodeURIComponent(created.token)}/consent`,
    { name: candidateName, email: candidateEmail },
  );
  const recoveryToken = consent.recoveryToken;
  console.log(`   session status: ${consent.session.status}`);

  console.log('5. Fetching question list...');
  const questionsResult = await getJson(
    `/async-video-interviews/${encodeURIComponent(created.sessionId)}/questions`,
    { 'x-recovery-token': recoveryToken },
  );
  const questions = questionsResult.questions;
  if (questions.length < 2) {
    throw new Error(`expected >= 2 questions, got ${questions.length}`);
  }

  console.log('6. Cutting a 30s excerpt for question 2 (ffmpeg)...');
  const excerpt = makeExcerpt();

  console.log('7. Uploading answer videos (Q1: 150s clip, Q2: 30s excerpt)...');
  await uploadVideo(created.sessionId, questions[0].id, recoveryToken, SOURCE_VIDEO, 150);
  console.log(`   uploaded Q1 (${questions[0].id})`);
  await uploadVideo(created.sessionId, questions[1].id, recoveryToken, excerpt, 30);
  console.log(`   uploaded Q2 (${questions[1].id})`);

  console.log('8. Polling analysis jobs (emulated amd64 MediaPipe is slow)...');
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastLine = '';
  let jobs = [];
  for (;;) {
    const session = await getJson(`/analysis/sessions/${created.sessionId}`, {
      authorization: `Bearer ${adminToken}`,
    });
    jobs = session.jobs.filter((j) => j.kind === 'multimodal_feature_extraction');
    const line = jobs
      .map((j) => `${(j.questionId ?? 'session').slice(0, 8)}:${j.status}`)
      .join(' ');
    if (line !== lastLine) {
      console.log(`   [${new Date().toISOString().slice(11, 19)}] ${line}`);
      lastLine = line;
    }
    const terminal = jobs.filter((j) => ['completed', 'failed', 'cancelled'].includes(j.status));
    if (jobs.length >= 2 && terminal.length === jobs.length) break;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for analysis jobs; last state: ${line}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const failed = jobs.filter((j) => j.status !== 'completed');
  const dlqRows = await dbQuery(
    `SELECT d.analysis_job_id, d.error_code, d.error_message
     FROM analysis_job_dlq d JOIN analysis_job j ON j.id = d.analysis_job_id
     WHERE j.session_id = $1`,
    [created.sessionId],
  );

  console.log('\n=== Results ===');
  const transcripts = await dbQuery(
    `SELECT question_id, answer_text FROM session_transcript WHERE session_id = $1 ORDER BY position`,
    [created.sessionId],
  );
  for (const question of questions.slice(0, 2)) {
    const transcript = transcripts.find((t) => t.question_id === question.id);
    console.log(`\nQuestion ${question.id}: ${question.prompt?.slice(0, 70) ?? ''}`);
    console.log(`transcript: ${transcript?.answer_text ?? '(none)'}`);
    try {
      const featureRes = await getJson(
        `/analysis/sessions/${created.sessionId}/questions/${question.id}/features`,
        { authorization: `Bearer ${adminToken}` },
      );
      printFeatures(`Q features (job ${featureRes.analysisJobId})`, featureRes.features);
      console.log(`media: ${JSON.stringify(featureRes.media)}`);
    } catch (err) {
      console.log(`features: UNAVAILABLE (${err.message})`);
    }
  }

  if (dlqRows.length > 0) {
    console.log('\nDLQ rows:');
    for (const row of dlqRows) {
      console.log(`  job ${row.analysis_job_id}: ${row.error_code} — ${row.error_message}`);
    }
  }

  if (failed.length > 0 || dlqRows.length > 0) {
    console.error(
      `\n❌ ${failed.length} job(s) not completed, ${dlqRows.length} DLQ row(s). Validation FAILED.`,
    );
    process.exit(1);
  }
  console.log(`\n✅ All ${jobs.length} analysis jobs completed. Validation PASSED.`);
  console.log(`sessionId: ${created.sessionId}`);
}

main().catch((err) => {
  console.error('\n❌ Validation failed:', err.message);
  process.exit(1);
});

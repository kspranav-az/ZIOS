#!/usr/bin/env node
/**
 * Seed an Ascend (M2) sandbox — candidate practice end-to-end over HTTP.
 *
 * Creates a fresh candidate account through the real OTP flow (code via
 * Mailpit), confirms the welcome grant, runs a full text practice mock
 * (library pack → consent → live debit → turn loop → judged report with
 * coaching tips), and prints the exact curl commands for each step so the
 * flow can be replayed by hand during the beta dress rehearsal.
 *
 * Usage:
 *   node scripts/seed-ascend-sandbox.js [--email you@example.com]
 *
 * Prerequisites: docker compose stack up (api :3000, mailpit :8025).
 */

const API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const MAILPIT = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
const args = process.argv.slice(2);
const emailFlag = args.indexOf('--email');
const email =
  emailFlag >= 0 && args[emailFlag + 1]
    ? args[emailFlag + 1]
    : `ascend-sandbox+${Date.now()}@example.com`;

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

async function patchJson(path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
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
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function waitForOtp(to) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json();
    const hit = (list.messages ?? []).find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()) &&
        m.Subject.includes('Ascend sign-in code'),
    );
    if (hit) {
      const detail = await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
      const match = /(\d{6})/.exec(detail.Text ?? '');
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no Ascend OTP email arrived for ${to}`);
}

const auth = (token) => ({ authorization: `Bearer ${token}` });
const show = (label, { status, body }) =>
  console.log(`  ${label} → ${status}\n    ${JSON.stringify(body).slice(0, 400)}`);

const MOCK_ANSWERS = [
  'I led the checkout migration end to end: legacy monolith was blocking releases, I moved traffic behind feature flags, and failed transactions dropped forty percent in one quarter.',
  'I rank by customer impact and communicate trade-offs in writing; during an outage I paused feature work and shipped a rollback within the hour.',
  'I mentor through weekly pairing and design-doc reviews; a documentation drive cut onboarding from three weeks to one.',
];

/** Answer turns until the conductor wraps up (guarded, mirrors the e2e loop). */
async function runToWrapup(sessionId, recovery, firstTurn, headers) {
  let turn = firstTurn;
  let n = 0;
  while (turn.type !== 'wrapup' && n < 14) {
    const submitted = await postJson(
      `/cand/practice/${sessionId}/turn`,
      { answer: MOCK_ANSWERS[n % MOCK_ANSWERS.length] },
      headers,
    );
    if (submitted.status !== 200) {
      show(`POST /cand/practice/${sessionId}/turn`, submitted);
      throw new Error(`turn ${n + 1} failed`);
    }
    turn = submitted.body.turn;
    n += 1;
    console.log(`   turn ${n}: ${turn.type}`);
  }
  if (turn.type !== 'wrapup') {
    throw new Error('mock did not wrap up within 14 turns');
  }
}

/** Create + consent + preflight a library-pack session (drives one debit). */
async function startLibraryMock(token, packId) {
  const created = await postJson('/cand/practice', { packId, mode: 'text' }, auth(token));
  if (created.status !== 201) {
    show('POST /cand/practice', created);
    throw new Error('create practice session failed');
  }
  const session = created.body.session;
  const recovery = created.body.recoveryToken;
  await postJson(
    `/cand/practice/${session.id}/consent`,
    { recordingAllowed: true },
    auth(token),
  );
  const preflight = await postJson(
    `/cand/practice/${session.id}/preflight`,
    {},
    { ...auth(token), 'x-recovery-token': recovery },
  );
  if (preflight.status !== 200) {
    show(`POST /cand/practice/${session.id}/preflight`, preflight);
    throw new Error('preflight failed');
  }
  return { sessionId: session.id, recovery, firstTurn: preflight.body.turn };
}

async function main() {
  console.log(`\nAscend sandbox — candidate ${email}\n`);

  console.log('1) Request OTP');
  show('POST /cand/auth/otp/request', await postJson('/cand/auth/otp/request', { email }));
  const otp = await waitForOtp(email);
  console.log(`   OTP from Mailpit: ${otp}`);

  console.log('2) Verify OTP (creates the account + 50-credit welcome grant)');
  const verified = await postJson('/cand/auth/otp/verify', { email, code: otp });
  show('POST /cand/auth/otp/verify', verified);
  const token = verified.body.session.token;
  console.log(`   token: ${token}`);

  console.log('3) Complete onboarding');
  show('PATCH /cand/me', await patchJson('/cand/me', { name: 'Sandbox Priya', targetRole: 'Backend Engineer' }, auth(token)));

  console.log('4) Wallet (expect balance 50)');
  show('GET /cand/wallet', await getJson('/cand/wallet', auth(token)));

  console.log('5) Practice library (3 starter packs)');
  const library = await getJson('/cand/practice/library', auth(token));
  show('GET /cand/practice/library', {
    status: library.status,
    body: {
      packs: library.body.packs.map((p) => ({ id: p.id, questions: p.questions.length })),
      consentVersion: library.body.consent.version,
    },
  });

  const pack = library.body.packs[0];
  console.log(`6) Create practice session (pack ${pack.id}, text mode)`);
  const created = await postJson('/cand/practice', { packId: pack.id, mode: 'text' }, auth(token));
  show('POST /cand/practice', created);
  const session = created.body.session;
  const recovery = created.body.recoveryToken;
  const recoveryHeaders = { ...auth(token), 'x-recovery-token': recovery };

  console.log('7) Store consent (X8: nothing is captured before this)');
  show(
    `POST /cand/practice/${session.id}/consent`,
    await postJson(`/cand/practice/${session.id}/consent`, { recordingAllowed: true }, auth(token)),
  );

  console.log('8) Preflight → live (exact 1-credit debit happens here)');
  const preflight = await postJson(`/cand/practice/${session.id}/preflight`, {}, recoveryHeaders);
  show(`POST /cand/practice/${session.id}/preflight`, preflight);
  let turn = preflight.body.turn;

  const answers = [
    'I led the checkout migration end to end: legacy monolith was blocking releases, I moved traffic behind feature flags, and failed transactions dropped forty percent in one quarter.',
    'I rank by customer impact and communicate trade-offs in writing; during an outage I paused feature work and shipped a rollback within the hour.',
    'I mentor through weekly pairing and design-doc reviews; a documentation drive cut onboarding from three weeks to one.',
  ];
  let turnCount = 0;
  while (turn.type !== 'wrapup' && turnCount < 14) {
    const submitted = await postJson(
      `/cand/practice/${session.id}/turn`,
      { answer: answers[turnCount % answers.length] },
      recoveryHeaders,
    );
    if (submitted.status !== 200) {
      show(`POST /cand/practice/${session.id}/turn`, submitted);
      throw new Error(`turn ${turnCount + 1} failed`);
    }
    turn = submitted.body.turn;
    turnCount += 1;
    console.log(`   turn ${turnCount}: ${turn.type}${turn.questionId ? ` (${turn.questionId})` : ''}`);
  }

  console.log('9) Wallet after live debit (expect balance 49)');
  show('GET /cand/wallet', await getJson('/cand/wallet', auth(token)));

  console.log('10) Judged report with evidence-linked coaching tips');
  const report = await getJson(`/cand/practice/${session.id}/report`, auth(token));
  show(`GET /cand/practice/${session.id}/report`, {
    status: report.status,
    body: {
      report: { status: report.body.report?.status, recommendation: report.body.report?.overallRecommendation },
      scores: report.body.scores.length,
      evidenceSpans: report.body.evidenceSpans.length,
      coachingTips: report.body.coachingTips,
    },
  });

  console.log('11) Upload resume (pasted text → parse + ATS report)');
  const resumeText =
    'Priya Sharma\npriya@example.com\n\nSkills:\n- Python\n- PostgreSQL\n\nExperience:\n- Led a team of 5 engineers\n- Cut latency by 40 percent\n';
  const resume = await postJson(
    '/cand/resume',
    {
      fileName: 'priya.txt',
      contentBase64: Buffer.from(resumeText).toString('base64'),
      text: resumeText,
    },
    auth(token),
  );
  show('POST /cand/resume', {
    status: resume.status,
    body: {
      fileName: resume.body?.fileName,
      skills: resume.body?.parsed?.skills,
      atsScore: resume.body?.atsReport?.score,
    },
  });

  console.log('12) JD-targeted mock (resume-informed snapshot, source jd)');
  const fromJd = await postJson(
    '/cand/practice/from-jd',
    {
      jdText:
        'Backend Engineer — build REST APIs in Python and PostgreSQL, own services end to end, mentor junior engineers, improve latency and reliability.',
      mode: 'text',
    },
    auth(token),
  );
  show('POST /cand/practice/from-jd', {
    status: fromJd.status,
    body: { id: fromJd.body?.session?.id, source: fromJd.body?.session?.source, title: fromJd.body?.session?.title },
  });
  const jdSession = fromJd.body.session;
  const jdRecovery = fromJd.body.recoveryToken;
  await postJson(`/cand/practice/${jdSession.id}/consent`, { recordingAllowed: true }, auth(token));
  const jdPreflight = await postJson(
    `/cand/practice/${jdSession.id}/preflight`,
    {},
    { ...auth(token), 'x-recovery-token': jdRecovery },
  );
  await runToWrapup(jdSession.id, jdRecovery, jdPreflight.body.turn, {
    ...auth(token),
    'x-recovery-token': jdRecovery,
  });

  console.log('13) Third library mock → completes the daily cap (3/day, D11)');
  const third = await startLibraryMock(token, 'hr-screening');
  await runToWrapup(third.sessionId, third.recovery, third.firstTurn, {
    ...auth(token),
    'x-recovery-token': third.recovery,
  });

  console.log('14) Progress + readiness after three judged mocks (D14/D15)');
  const progress = await getJson('/cand/practice/progress', auth(token));
  show('GET /cand/practice/progress', {
    status: progress.status,
    body: {
      sessions: progress.body.sessions?.length,
      trends: progress.body.trends,
      streak: progress.body.streak,
      dailyCap: progress.body.dailyCap,
    },
  });
  show('GET /cand/practice/readiness', await getJson('/cand/practice/readiness', auth(token)));

  console.log('15) Operator top-up (grant-credits.js --holder candidate) + wallet');
  const grantEnv = {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ??
      'postgresql://interviewos:interviewos_dev@localhost:55432/interviewos',
  };
  const { execFileSync } = await import('node:child_process');
  const scriptPath = new URL('./grant-credits.js', import.meta.url).pathname;
  const grantOut = execFileSync(
    process.execPath,
    [scriptPath, '--holder', 'candidate', '--email', email, '25', 'dress rehearsal top-up'],
    { env: grantEnv, encoding: 'utf8' },
  ).trim();
  console.log(`  grant-credits.js → ${grantOut}`);
  const walletAfter = await getJson('/cand/wallet', auth(token));
  show('GET /cand/wallet (ledger)', {
    status: walletAfter.status,
    body: {
      balance: walletAfter.body.balance,
      ledger: walletAfter.body.ledger?.map((e) => `${e.reason} ${e.delta > 0 ? '+' : ''}${e.delta}`),
    },
  });

  console.log('16) Fourth create today → 429 DAILY_CAP_REACHED');
  const fourth = await postJson('/cand/practice', { packId: 'hr-screening', mode: 'text' }, auth(token));
  show('POST /cand/practice (4th today)', {
    status: fourth.status,
    body: fourth.status === 429 ? fourth.body : fourth.body,
  });
  if (fourth.status !== 429) {
    throw new Error(`expected 429 DAILY_CAP_REACHED, got ${fourth.status}`);
  }

  console.log('\nReplay by hand (bash):');
  console.log(`  TOKEN=${token}`);
  console.log(`  RECOVERY=${recovery}`);
  console.log(`  SESSION=${session.id}`);
  console.log(`  curl -H "authorization: Bearer $TOKEN" ${API}/cand/wallet`);
  console.log(`  curl -H "authorization: Bearer $TOKEN" ${API}/cand/practice/$SESSION/report\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

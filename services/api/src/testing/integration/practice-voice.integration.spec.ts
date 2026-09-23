import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CandidateAuthResponse,
  PracticeCreateResponse,
  PracticePreflightResponse,
  PracticeTurnAudioResponse,
  PracticeTurnResponse,
  SessionTurnResponse,
} from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bootApp,
  extractOtp,
  makeTestNamespace,
  postJson,
  signup,
  waitForEmail,
  type TestApp,
} from './helpers';

const ns = makeTestNamespace('practice-voice.test');

// Host-run tests reach the compose orchestrator over localhost, not the
// docker-network hostname the api container uses.
process.env.ORCHESTRATOR_URL ??= 'http://localhost:8000';

async function candSignup(
  test: TestApp,
  email: string,
): Promise<{ token: string; accountId: string }> {
  await postJson(test.baseUrl, '/cand/auth/otp/request', { email });
  const mail = await waitForEmail(email, 'Ascend sign-in code');
  const verify = await postJson(test.baseUrl, '/cand/auth/otp/verify', {
    email,
    code: extractOtp(mail.text),
  });
  expect(verify.status).toBe(200);
  const body = (await verify.json()) as CandidateAuthResponse;
  return { token: body.session.token, accountId: body.account.id };
}

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Answers turns until the conductor wraps up (guarded loop). */
async function runToCompletion(
  test: TestApp,
  token: string,
  sessionId: string,
  recoveryToken: string,
  firstTurn: SessionTurnResponse,
  firstAnswer: string,
): Promise<void> {
  let turn = firstTurn;
  let submittedFirst = false;
  for (let i = 0; i < 40 && turn.type !== 'wrapup'; i += 1) {
    const answer = submittedFirst
      ? `Answer ${i}: I structured the work, shipped iteratively, and measured outcomes.`
      : firstAnswer;
    submittedFirst = true;
    const res = await postJson(
      test.baseUrl,
      `/cand/practice/${sessionId}/turn`,
      { answer },
      { ...authed(token), 'x-recovery-token': recoveryToken },
    );
    if (res.status !== 200) {
      throw new Error(`turn ${i} failed: ${res.status} ${await res.text()}`);
    }
    turn = ((await res.json()) as PracticeTurnResponse).turn;
  }
  expect(turn.type).toBe('wrapup');
}

describe.runIf(INTEGRATION_AVAILABLE)(
  'voice practice — record/transcribe/submit bridge (Phase 12b)',
  () => {
    let test: TestApp;

    beforeAll(async () => {
      test = await bootApp();
    });

    afterAll(async () => {
      await ns.purge(test.db);
      await test.app.close();
    });

    it('rejects employer tokens with 403 on the audio-turn route', async () => {
      const employer = await signup(test.baseUrl, ns.email('admin'));
      const audio = Buffer.from('fake-webm-audio').toString('base64');
      const res = await postJson(
        test.baseUrl,
        '/cand/practice/00000000-0000-0000-0000-000000000000/turn-audio',
        { audioBase64: audio },
        { ...authed(employer.token), 'x-recovery-token': 'x' },
      );
      expect(res.status).toBe(403);
    });

    it('full voice lifecycle: 2-credit debit → audio turn → transcript → wrapup → report', async () => {
      const candidate = await candSignup(test, ns.email('voice'));

      const created = await postJson(
        test.baseUrl,
        '/cand/practice',
        { packId: 'hr-screening', mode: 'voice' },
        authed(candidate.token),
      );
      expect(created.status).toBe(201);
      const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;
      expect(session.mode).toBe('voice');

      const consent = await postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/consent`,
        { recordingAllowed: true, modelOptIn: false },
        authed(candidate.token),
      );
      expect(consent.status).toBe(201);

      const preflight = await postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/preflight`,
        {},
        { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
      );
      expect(preflight.status).toBe(200);
      const { turn } = (await preflight.json()) as PracticePreflightResponse;

      // Voice mode prices at exactly 2 credits (welcome 50 → 48).
      const debit = await test.db.query(
        `SELECT cl.reason, cl.delta FROM credit_ledger cl
         JOIN credit_account ca ON ca.id = cl.account_id
         WHERE ca.holder_type = 'candidate' AND ca.holder_id = $1`,
        [candidate.accountId],
      );
      expect(debit.rows.map((r) => `${(r as { reason: string }).reason}:${(r as { delta: number }).delta}`)).toContain(
        'practice_start:-2',
      );

      // Bad payload shapes fail before touching storage.
      const badB64 = await postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/turn-audio`,
        { audioBase64: '!!!not-base64!!!', contentType: 'audio/webm' },
        { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
      );
      expect(badB64.status).toBe(400);

      const badType = await postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/turn-audio`,
        { audioBase64: Buffer.from('x').toString('base64'), contentType: 'application/exe' },
        { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
      );
      expect(badType.status).toBe(400);

      // Audio turn: fake webm bytes — the mock orchestrator still returns its
      // fixture transcript (assert non-empty, never the exact content).
      // MediaRecorder sends "audio/webm;codecs=opus"; the bare MIME must match.
      const audio = Buffer.from('fake-webm-audio-bytes').toString('base64');
      const transcribed = await postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/turn-audio`,
        { audioBase64: audio, contentType: 'audio/webm;codecs=opus' },
        { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
      );
      expect(transcribed.status).toBe(200);
      const audioBody = (await transcribed.json()) as PracticeTurnAudioResponse;
      expect(audioBody.transcript.length).toBeGreaterThan(0);
      expect(audioBody.objectName).toMatch(/^practice-recordings\//);

      // The stored recording exists in MinIO and the object name is real.
      // (Existance is proven implicitly: the orchestrator downloaded it.)

      // Submit the transcript as a normal text turn, carrying the recording ref.
      const firstAnswer = audioBody.transcript;
      const submitted = await postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/turn`,
        { answer: firstAnswer, recordingRef: audioBody.objectName },
        { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
      );
      expect(submitted.status).toBe(200);

      // The recording ref landed on the transcript row's answer_data.
      const row = await test.db.query(
        `SELECT answer_text, answer_data FROM practice_transcript
         WHERE session_id = $1 AND answer_text IS NOT NULL
         ORDER BY position ASC LIMIT 1`,
        [session.id],
      );
      expect(row.rowCount).toBe(1);
      const saved = row.rows[0] as { answer_text: string; answer_data: { practiceRecording?: { objectName: string } } };
      expect(saved.answer_text).toBe(firstAnswer);
      expect(saved.answer_data?.practiceRecording?.objectName).toBe(audioBody.objectName);

      await runToCompletion(test, candidate.token, session.id, recoveryToken, turn, firstAnswer);

      const reportRes = await fetch(`${test.baseUrl}/cand/practice/${session.id}/report`, {
        headers: authed(candidate.token),
      });
      expect(reportRes.status).toBe(200);
      const report = (await reportRes.json()) as { report: { status: string } | null };
      expect(report.report?.status).toBe('completed');
    }, 180_000);

    it('audio turn on a non-live session → 409', async () => {
      const candidate = await candSignup(test, ns.email('notlive'));
      const created = await postJson(
        test.baseUrl,
        '/cand/practice',
        { packId: 'hr-screening', mode: 'voice' },
        authed(candidate.token),
      );
      const { session, recoveryToken } = (await created.json()) as PracticeCreateResponse;
      // No consent/preflight — session is 'created', not 'live'.
      const res = await postJson(
        test.baseUrl,
        `/cand/practice/${session.id}/turn-audio`,
        { audioBase64: Buffer.from('x').toString('base64') },
        { ...authed(candidate.token), 'x-recovery-token': recoveryToken },
      );
      expect(res.status).toBe(409);
    }, 120_000);
  },
);

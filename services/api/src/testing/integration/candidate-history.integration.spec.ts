import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CandidateAuthResponse,
  CandidateHistoryResponse,
  CreateCandidateInviteResponse,
  KitResponse,
  PublishKitResponse,
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

const ns = makeTestNamespace('cand-history.test');

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

describe.runIf(INTEGRATION_AVAILABLE)('candidate interview history (Phase 12e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await bootApp();
  }, 120_000);

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('links company interviews by exact email (case-insensitive) and returns candidate-safe rows', async () => {
    // --- Employer side: org + published kit + invite for the candidate ---
    const employer = await signup(test.baseUrl, ns.email('hist-employer'));
    await test.db.query('UPDATE org SET name = $1 WHERE id = $2', [
      'ZeTheta Robotics',
      employer.org.id,
    ]);

    const kitRes = await postJson(
      test.baseUrl,
      '/kits',
      { title: 'Backend Loop', role: 'Backend Engineer', level: 'Mid' },
      authed(employer.token),
    );
    expect(kitRes.status).toBe(201);
    const { kit } = (await kitRes.json()) as KitResponse;

    const questionRes = await postJson(
      test.baseUrl,
      `/kits/${kit.id}/questions`,
      {
        type: 'open_ended',
        prompt: 'Tell me about a time you owned an outage end to end.',
        topic: 'Behavioral',
        rubricLines: [{ id: 'r1', text: 'Clarity and ownership', weight: 1 }],
      },
      authed(employer.token),
    );
    expect(questionRes.status).toBe(201);

    const published = await postJson(
      test.baseUrl,
      `/kits/${kit.id}/publish`,
      {},
      authed(employer.token),
    );
    expect(published.status).toBe(201);
    const { version } = (await published.json()) as PublishKitResponse;

    // The account email differs in CASE from the invite email — citext makes
    // the match; fuzzy matching would be a privacy bug.
    const inviteEmail = ns.email('hist-candidate');
    const accountEmail = inviteEmail.toUpperCase();

    const inviteRes = await postJson(
      test.baseUrl,
      '/invites',
      {
        kitVersionId: version.id,
        candidate: { name: 'History Priya', email: inviteEmail },
      },
      authed(employer.token),
    );
    expect(inviteRes.status).toBe(201);
    const invite = (await inviteRes.json()) as CreateCandidateInviteResponse;

    // Consent is where the interview session is born (X8: consent before
    // capture), so drive it through the real by-token flow.
    const consentRes = await postJson(test.baseUrl, `/invites/by-token/${invite.token}/consent`, {
      name: 'History Priya',
    });
    expect(consentRes.status).toBe(200);
    const { session: companySession } = (await consentRes.json()) as {
      session: { id: string };
      recoveryToken: string;
    };

    // Mark the session completed — the full interview loop has its own specs;
    // here we test the history read model.
    await test.db.query(
      `UPDATE interview_session
       SET status = 'completed', started_at = now() - interval '20 minutes', ended_at = now()
       WHERE id = $1`,
      [companySession.id],
    );

    // --- Candidate side: history shows the company interview ---
    const candidate = await candSignup(test, accountEmail);
    const historyRes = await fetch(`${test.baseUrl}/cand/me/history`, {
      headers: authed(candidate.token),
    });
    expect(historyRes.status).toBe(200);
    const history = (await historyRes.json()) as CandidateHistoryResponse;

    expect(history.company).toHaveLength(1);
    const row = history.company[0]!;
    expect(row.orgName).toBe('ZeTheta Robotics');
    expect(row.roleTitle).toBe('Backend Engineer');
    expect(row.status).toBe('completed');
    expect(row.startedAt).not.toBeNull();
    expect(row.completedAt).not.toBeNull();
    expect(row.reportAvailable).toBe(false);
    expect(history.practice).toBeDefined();
    expect(history.practice.sessions).toEqual([]);

    // Lazy link is idempotent: a second read returns the same single row and
    // the link column stays put.
    const again = await fetch(`${test.baseUrl}/cand/me/history`, {
      headers: authed(candidate.token),
    });
    const history2 = (await again.json()) as CandidateHistoryResponse;
    expect(history2.company).toHaveLength(1);
    const links = await test.db.query(
      `SELECT count(*)::int AS n FROM candidate
       WHERE candidate_account_id = $1 AND email = $2`,
      [candidate.accountId, inviteEmail],
    );
    expect((links.rows[0] as { n: number }).n).toBe(1);

    // An account whose email matches no employer-side candidate sees none.
    const stranger = await candSignup(test, ns.email('hist-stranger'));
    const strangerRes = await fetch(`${test.baseUrl}/cand/me/history`, {
      headers: authed(stranger.token),
    });
    const strangerHistory = (await strangerRes.json()) as CandidateHistoryResponse;
    expect(strangerHistory.company).toEqual([]);

    // Employer tokens are the wrong audience for candidate routes.
    const forbidden = await fetch(`${test.baseUrl}/cand/me/history`, {
      headers: authed(employer.token),
    });
    expect(forbidden.status).toBe(403);
  }, 120_000);
});

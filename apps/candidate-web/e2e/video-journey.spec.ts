import { expect, test } from '@playwright/test';
import {
  adminEmail,
  candidateEmail,
  createCandidateInvite,
  createPublishedKit,
  signupAdmin,
} from './helpers';

async function signInAsAdminWithToken(page: import('@playwright/test').Page, token: string) {
  await page.context().addCookies([
    {
      name: 'zios_session',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Phase 08 golden journey: strict video interview captures integrity signals,
 * the candidate sees the proctoring disclosure, and the employer dispositions
 * flags from the report panel.
 */
test('strict video interview → integrity flags → human disposition', async ({ page, browser }) => {
  const admin = adminEmail();
  const { token: adminToken } = await signupAdmin(admin);
  const { versionId } = await createPublishedKit(adminToken, 'video', 'strict');
  const candidate = candidateEmail();
  const rawToken = await createCandidateInvite(adminToken, versionId, {
    name: 'E2E Video Alice',
    email: candidate,
  });

  // Candidate: consent screen shows strict proctoring disclosure.
  await page.goto(`/?token=${rawToken}`);
  await expect(page.getByRole('heading', { name: /Before we begin/i })).toBeVisible();
  await expect(page.getByText(/Proctoring level: strict/i)).toBeVisible();
  await expect(page.getByText(/periodic webcam snapshots/i)).toBeVisible();

  await page.getByLabel(/Full name/i).fill('E2E Video Alice');
  await page.getByLabel(/Email/i).fill(candidate);
  await page.getByRole('button', { name: /I understand and agree/i }).click();

  // Preflight and start video interview.
  await expect(page.getByRole('heading', { name: /Ready to start/i })).toBeVisible();
  await page.getByRole('button', { name: /Start interview/i }).click();
  await expect(page.getByRole('heading', { name: /Video interview/i })).toBeVisible();

  // Trigger integrity signals directly in the browser.
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('paste'));
  });

  // Fallback to text so the interview can be completed without real media.
  await page.getByRole('button', { name: /Switch to text/i }).click();
  await expect(page.getByRole('heading', { name: /Interview in progress/i })).toBeVisible();

  // Complete the interview via API using the recovery token stored in sessionStorage.
  const sessionId = await page.evaluate(() => sessionStorage.getItem('zios:sessionId'));
  if (!sessionId) {
    throw new Error('session id not found in sessionStorage');
  }
  const recoveryToken = await page.evaluate(
    (sid) => sessionStorage.getItem(`zios:recoveryToken:${sid}`),
    sessionId,
  );
  if (!recoveryToken) {
    throw new Error('recovery token not found in sessionStorage');
  }

  const answers = [
    'I led a migration project with a tight timeline and cross-functional stakeholders.',
    'I prioritise and communicate blockers early to keep delivery predictable.',
    'We refactored the payment module over two sprints while keeping daily standups focused.',
  ];
  for (const answer of answers) {
    const turn = await fetch(
      `http://localhost:3000/sessions/${encodeURIComponent(sessionId)}/turn`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-recovery-token': recoveryToken,
        },
        body: JSON.stringify({ answer }),
      },
    );
    if (!turn.ok) {
      throw new Error(`turn failed: ${turn.status} ${await turn.text()}`);
    }
    const turnBody = (await turn.json()) as { turn: { type: string } };
    if (turnBody.turn.type === 'wrapup') break;
  }

  // Employer: open report and disposition a pending flag.
  const employerPage = await browser.newPage();
  await signInAsAdminWithToken(employerPage, adminToken);
  await employerPage.goto(`http://localhost:5173/interviews/${sessionId}`);
  await expect(employerPage.getByRole('heading', { name: /E2E Video Alice/i })).toBeVisible();
  await expect(employerPage.locator('dd', { hasText: /Video/i }).first()).toBeVisible();
  await expect(employerPage.getByRole('heading', { name: /Integrity flags/i })).toBeVisible();

  const dispositionButton = employerPage.getByRole('button', { name: /Disposition/i }).first();
  await expect(dispositionButton).toBeVisible();
  await dispositionButton.click();
  await expect(employerPage.getByRole('heading', { name: /Disposition flag/i })).toBeVisible();
  await employerPage.getByLabel(/Reason code/i).selectOption('false_positive');
  await employerPage.getByRole('button', { name: /Save disposition/i }).click();
  await expect(employerPage.getByText(/dismissed/i).first()).toBeVisible();
  await employerPage.close();
});

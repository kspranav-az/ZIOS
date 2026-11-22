import { expect, test, type Page } from '@playwright/test';
import {
  adminEmail,
  candidateEmail,
  createPublishedKit,
  signupAdmin,
} from '../../candidate-web/e2e/helpers';
import { completeInterviewViaApi } from './helpers';
import { waitForInviteEmail, waitForOtpCode } from './mailpit';

/**
 * Employer invite hub journey (plans/employer-invite-ui-and-email.md):
 * admin signs in → Candidates page → Send interview dialog (single tab) →
 * invite email lands in Mailpit → candidate completes the interview via the
 * API (candidate UI itself is covered by candidate-web e2e) → roster shows
 * the invite as Completed.
 */

async function signInThroughUi(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const code = await waitForOtpCode(email);
  await page.getByLabel('Digit 1 of 6').pressSequentially(code);
}

test('employer invites a candidate from the roster; email lands; status flips to completed', async ({
  page,
}) => {
  // Seed the org + a published text kit through the API (helpers exist in
  // candidate-web/e2e and are re-exported by ./helpers).
  const email = adminEmail();
  const { token: adminToken } = await signupAdmin(email);
  await createPublishedKit(adminToken, 'text', 'none');

  // 1. Sign in to the employer web through the UI (cookie session).
  await signInThroughUi(page, email);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  // 2. Candidates page → Send interview dialog.
  await page.goto('/candidates');
  await expect(page.getByRole('heading', { name: 'Candidates' })).toBeVisible();
  await page.getByRole('button', { name: 'Send interview' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Send interview invite' })).toBeVisible();

  // 3. Single tab: pick the kit (version auto-selects latest published).
  await page.getByLabel('Kit').selectOption({ index: 1 });
  const candidate = { name: 'E2E Candidate', email: candidateEmail() };
  await page.getByLabel('Full name').fill(candidate.name);
  await page.getByLabel('Email address').fill(candidate.email);
  await page.getByRole('button', { name: 'Send & show link' }).click();

  // 4. Copy-once success state with the raw link.
  await expect(page.getByText('This link is shown once — copy it now.')).toBeVisible();
  const linkInput = page.getByLabel('Candidate link');
  await expect(linkInput).toBeVisible();
  const link = await linkInput.inputValue();
  expect(link).toContain('/?token=');
  const rawToken = decodeURIComponent(link.split('?token=')[1]!);

  // 5. The invite email arrived independently in Mailpit (D5).
  const mailToken = await waitForInviteEmail(candidate.email);
  expect(mailToken).toBe(rawToken);

  // 6. Candidate completes the interview (API-driven; candidate-web UI
  //    journey has its own e2e suite).
  await completeInterviewViaApi(rawToken, candidate, [
    'I built a modular monolith with an event outbox.',
    'I would add idempotency keys and a dead-letter queue.',
  ]);

  // 7. Back in the employer roster: status chip flips to Completed.
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(page.getByRole('cell', { name: 'Completed' })).toBeVisible();
  await expect(page.getByText(candidate.email)).toBeVisible();
});

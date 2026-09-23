import { expect, test } from '@playwright/test';
import { candidateEmail, extractOtp, waitForEmail } from './helpers';

/**
 * Ascend golden journey (Phase 12, M2): OTP sign-up → onboarding → text
 * practice mock (library pack) → consent → turn loop → judged report with
 * evidence-linked coaching tips. Runs against the real compose stack with
 * the stubbed LLM provider.
 */
test('candidate signs up, runs a text practice mock and gets a coaching report', async ({
  page,
}) => {
  const email = candidateEmail();

  // --- Sign in with an email code ---
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole('button', { name: /send sign-in code/i }).click();

  const mail = await waitForEmail(email, 'Ascend sign-in code');
  const otp = extractOtp(mail.text);
  const boxes = page.getByRole('textbox');
  for (let i = 0; i < 6; i += 1) {
    await boxes.nth(i).fill(otp[i]!);
  }

  // --- New user lands on onboarding ---
  await expect(page.getByLabel(/your name/i)).toBeVisible();
  await page.getByLabel(/your name/i).fill('E2E Priya');
  await page.getByLabel(/target role/i).fill('Backend Engineer');
  await page.getByRole('button', { name: /continue|save|finish/i }).first().click();

  // --- Home: wallet chip shows the welcome grant (50) minus nothing yet ---
  await expect(page).toHaveURL(/\//);
  await expect(page.getByTestId('wallet-balance')).toHaveText('50');

  // --- Start a practice mock ---
  await page.getByRole('button', { name: /start a practice mock/i }).click();
  await expect(page).toHaveURL(/\/practice$/);
  await page.getByText(/HR Screening/i).first().click();
  await page.getByRole('button', { name: /continue to consent/i }).click();

  // --- Consent gate (X8) ---
  await expect(page).toHaveURL(/\/consent$/);
  await expect(page.getByRole('button', { name: /i consent — start the mock/i })).toBeDisabled();
  await page.getByTestId('consent-recording').check();
  await page.getByRole('button', { name: /i consent — start the mock/i }).click();

  // --- Text interview: answer until wrapup (max 14 turns) ---
  await expect(page).toHaveURL(/\/interview$/);
  const answers = [
    'In my last role I owned the checkout migration end to end. The situation was a legacy monolith blocking releases, my task was to de-risk payments, I moved traffic gradually behind feature flags, and the result was a forty percent drop in failed transactions over one quarter.',
    'When priorities collide I rank by customer impact and communicate the trade-off in writing. For example, during an outage I paused feature work, paired on the hotfix, and shipped a rollback within the hour while keeping support updated.',
    'I mentor by pairing weekly and reviewing design docs before code. I ran a documentation drive that cut onboarding time for new engineers from three weeks to one, and two of my mentees now lead their own services.',
    'A conflict I handled well was a disagreement on schema design. I proposed a spike comparing both approaches with real query loads, the data showed my colleague’s option was faster, and we adopted it with a shared follow-up checklist.',
  ];
  for (let turn = 0; turn < 14; turn += 1) {
    if (page.url().includes('/report')) break;
    const textarea = page.getByLabel(/your answer/i);
    await expect(textarea).toBeVisible({ timeout: 30_000 });
    await textarea.fill(answers[turn % answers.length]!);
    await page.getByRole('button', { name: /submit answer/i }).click();
    await page.waitForTimeout(500);
  }

  // --- Report: judged, evidence-linked, with coaching tips; debit applied ---
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByText(/your practice report/i)).toBeVisible();
  await expect(page.getByText(/clarity|structure|communication/i).first()).toBeVisible();
  await expect(page.getByText(/coach’s corner|coach's corner/i)).toBeVisible();
  await expect(page.getByText(/replay/i).first()).toBeVisible();

  // Exact debit: text mock = 1 credit → wallet chip shows 49.
  await expect(page.getByTestId('wallet-balance')).toHaveText('49');
});

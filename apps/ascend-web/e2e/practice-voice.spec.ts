import { expect, test } from '@playwright/test';
import { candidateEmail, extractOtp, waitForEmail } from './helpers';

/**
 * Ascend voice-practice golden journey (Phase 12b): OTP sign-up → onboarding
 * → voice mock (record → transcribe → submit) → judged report. Headless
 * chromium records from the fake device; the mock STT returns its fixture
 * transcript regardless of audio content, so the flow is hermetic.
 */
test('candidate runs a voice practice mock and gets a coaching report', async ({
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
  await page.getByLabel(/your name/i).fill('E2E Voice Priya');
  await page.getByLabel(/target role/i).fill('Backend Engineer');
  await page.getByRole('button', { name: /continue|save|finish/i }).first().click();

  // --- Home: wallet chip shows the welcome grant (50) ---
  await expect(page).toHaveURL(/\//);
  await expect(page.getByTestId('wallet-balance')).toHaveText('50');

  // --- Start a VOICE practice mock ---
  await page.getByRole('button', { name: /start a practice mock/i }).click();
  await expect(page).toHaveURL(/\/practice$/);
  await page.getByText(/HR Screening/i).first().click();
  await page.getByRole('button', { name: /^voice/i }).click();
  await page.getByRole('button', { name: /continue to consent/i }).click();

  // --- Consent gate (X8) ---
  await expect(page).toHaveURL(/\/consent$/);
  await page.getByTestId('consent-recording').check();
  await page.getByRole('button', { name: /i consent — start the mock/i }).click();

  // --- Voice interview: record → stop → auto-submit, until wrapup ---
  // (D2: the transcript is submitted directly — no editable box in the happy path.)
  await expect(page).toHaveURL(/\/interview$/);
  for (let turn = 0; turn < 14; turn += 1) {
    if (page.url().includes('/report')) break;
    const record = page.getByRole('button', { name: /^record$/i });
    await expect(record).toBeVisible({ timeout: 30_000 });
    await record.click();
    await page.waitForTimeout(1200); // let the fake device produce some audio
    await page.getByRole('button', { name: /^stop$/i }).click();

    // The mock STT transcript is auto-submitted; wait for the next question
    // (Record back) or the report route.
    await expect(page).toHaveURL(/\/interview$|\/report$/, { timeout: 30_000 });
    await expect
      .poll(async () => page.url().includes('/report') || (await record.isVisible().catch(() => false)))
      .toBe(true, { timeout: 30_000 });
  }

  // --- Report renders; voice debit is exactly 2 (50 → 48) ---
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByText(/your practice report/i)).toBeVisible();
  await expect(page.getByText(/coach’s corner|coach's corner/i)).toBeVisible();
  await expect(page.getByTestId('wallet-balance')).toHaveText('48');
});

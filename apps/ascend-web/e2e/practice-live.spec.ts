import { expect, test } from '@playwright/test';
import { candidateEmail, extractOtp, waitForEmail } from './helpers';

/**
 * Ascend live-practice golden journey (Phase 12e): OTP sign-up → onboarding
 * → live room mock (LiveKit room + orchestrator AI interviewer) → text
 * handoff for the remaining questions → judged report.
 *
 * Requires the host orchestrator (`source services/ai-orchestrator/.env.host
 * && uv run uvicorn app.main:app --reload --port 8000`) and the api container
 * with ORCHESTRATOR_URL pointing at it (docker-compose.override.yml from
 * Phase 12c). Runs hermetic on LLM mock adapters + mock STT/TTS.
 */
test('candidate runs a live practice mock and gets a coaching report', async ({ page }) => {
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
  await page.getByLabel(/your name/i).fill('E2E Live Priya');
  await page.getByLabel(/target role/i).fill('Backend Engineer');
  await page
    .getByRole('button', { name: /continue|save|finish/i })
    .first()
    .click();

  // --- Start a live practice mock ---
  await expect(page).toHaveURL(/\//);
  await page.getByRole('button', { name: /start a practice mock/i }).click();
  await expect(page).toHaveURL(/\/practice$/);
  await page
    .getByText(/HR Screening/i)
    .first()
    .click();
  await page.getByRole('button', { name: /^live room/i }).click();
  await page.getByRole('button', { name: /continue to consent/i }).click();

  // --- Consent gate (X8) ---
  await expect(page).toHaveURL(/\/consent$/);
  await page.getByTestId('consent-recording').check();
  await page.getByRole('button', { name: /i consent — start the mock/i }).click();

  // --- Live room: preflight → token → LiveKit connect → orchestrator turn.
  // The room phase plays the opening exchange; when the orchestrator socket
  // closes (one turn per socket), the UI hands off to the text conductor for
  // the remaining questions.
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByText(/live practice/i).first()).toBeVisible();
  await expect(page).toHaveURL(/\/interview\?room=done$/, { timeout: 60_000 });

  // --- Text handoff: answer until wrapup (max 14 turns) ---
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
    // The final answer triggers wrapup → immediate navigation to the report.
    // Give that navigation a beat before the next loop iteration tries to
    // fill the (about-to-be-detached) textarea.
    await page.waitForURL(/\/report$/, { timeout: 5_000 }).catch(() => {});
  }

  // --- Judged report ---
  await expect(page).toHaveURL(/\/report$/, { timeout: 60_000 });
  await expect(page.getByText(/practice report|your practice report/i)).toBeVisible();
  await expect(page.getByText(/coach’s corner|coach's corner/i)).toBeVisible();
});

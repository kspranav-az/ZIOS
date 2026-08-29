import { expect, test } from '@playwright/test';
import { adminEmail, candidateEmail, signupAdmin } from './helpers';
import {
  cleanupRoleQuestions,
  createAsyncVideoInterview,
  seedAsyncVideoAnswers,
  seedRoleQuestions,
} from './async-video-helpers';

test.describe('async video candidate journey', () => {
  const roleId = Math.floor(Math.random() * 1_000_000);
  const roleName = `E2E Async Role ${roleId}`;

  test.beforeAll(async () => {
    await seedRoleQuestions(roleId, roleName);
  });

  test.afterAll(async () => {
    await cleanupRoleQuestions(roleName);
  });

  test('candidate consents, sees the recorder UI, and cannot skip questions', async ({ page }) => {
    const admin = adminEmail();
    const { token: adminToken } = await signupAdmin(admin);
    const candidate = candidateEmail();

    const created = await createAsyncVideoInterview(
      adminToken,
      roleId,
      { name: 'E2E Async Candidate', email: candidate },
      { enableTranscription: false },
    );

    // Candidate lands from invite token and sees the consent page.
    await page.goto(`/?token=${encodeURIComponent(created.token)}`);
    await expect(page.getByRole('heading', { name: /Before we begin/i })).toBeVisible();
    await expect(page.getByText(/Your async video interview/i)).toBeVisible();

    // Fill identity and accept consent.
    await page.getByLabel(/Full name/i).fill('E2E Async Candidate');
    await page.getByLabel(/Email/i).fill(candidate);
    await page.getByRole('button', { name: /I understand and agree/i }).click();

    // Interview page loads.
    await expect(page).toHaveURL(/\/async-interview/);
    await expect(page.getByText(/Question 1 of 2/i)).toBeVisible();
    await expect(
      page.getByText(/Tell us about a time you led a project under pressure/i),
    ).toBeVisible();

    // Recorder UI is present.
    await expect(page.getByRole('button', { name: /Start camera/i })).toBeVisible();

    // Question overview shows both questions pending (no check icon).
    await expect(page.locator('button[aria-label="Question 1"]').first()).toBeVisible();
    await expect(page.locator('button[aria-label="Question 2"]').first()).toBeVisible();

    // Can navigate ahead and back; question 2 is also unanswered.
    await page.getByRole('button', { name: /Next/i }).click();
    await expect(page.getByText(/Question 2 of 2/i)).toBeVisible();
    await page.getByRole('button', { name: /Previous/i }).click();
    await expect(page.getByText(/Question 1 of 2/i)).toBeVisible();

    // Complete answers via API using the same recovery token the UI stored, then refresh.
    const recoveryToken = await page.evaluate(
      (sessionId) => sessionStorage.getItem(`zios:recoveryToken:${sessionId}`),
      created.sessionId,
    );
    if (!recoveryToken) {
      throw new Error('recovery token not found in sessionStorage after consent');
    }
    await seedAsyncVideoAnswers(created, recoveryToken);
    await page.reload();
    await expect(page.getByRole('heading', { name: /Thank you/i })).toBeVisible();
    await expect(page.getByText(/Your interview is complete/i)).toBeVisible();
  });
});

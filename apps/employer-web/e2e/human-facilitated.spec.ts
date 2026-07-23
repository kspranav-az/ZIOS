import { expect, test } from '@playwright/test';
import {
  adminEmail,
  candidateEmail,
  createHumanSession,
  scheduleInterview,
  signupAdmin,
} from './helpers';

/**
 * Phase 09 golden journey: human-facilitated interview is scheduled, conducted
 * from the interviewer cockpit, ended, scored via structured scorecard, and
 * surfaced as a completed report with evidence.
 */

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

test.describe('human-facilitated interview', () => {
  test('schedule → cockpit coverage → end call → scorecard → report', async ({ page }) => {
    const admin = adminEmail();
    const { token: adminToken } = await signupAdmin(admin);
    const candidate = candidateEmail();

    const { inviteId, sessionId } = await createHumanSession(adminToken, {
      name: 'E2E Human Candidate',
      email: candidate,
    });

    // Schedule the interview for now so the room window is open.
    await scheduleInterview(adminToken, inviteId, new Date());

    // Sign in as admin and open the cockpit.
    await signInAsAdminWithToken(page, adminToken);
    await page.goto(`/interviews/${sessionId}/cockpit`);
    await expect(page.getByRole('heading', { name: 'E2E Human Candidate' })).toBeVisible();

    // Coverage panel starts empty.
    await expect(page.getByText(/Coverage/i).first()).toBeVisible();
    await expect(page.getByText(/Kit questions/i)).toBeVisible();

    // Mark the first question covered and the second skipped.
    const coverButtons = page.getByRole('button', { name: 'Cover' });
    const skipButtons = page.getByRole('button', { name: 'Skip' });
    await coverButtons.first().click();
    await skipButtons.nth(1).click();
    await expect(page.getByText(/2\/2/).first()).toBeVisible();

    // End the call; should redirect to scorecard.
    await page.getByRole('button', { name: 'End call' }).click();
    await expect(page).toHaveURL(new RegExp(`/interviews/${sessionId}/scorecard$`));

    // Generate AI pre-fill if it is not already present.
    const prefillButton = page.getByRole('button', {
      name: /Generate AI prefill|Regenerate prefill/i,
    });
    await prefillButton.click();

    // Wait for criteria to render and score every criterion.
    await expect(page.getByText(/Clarity/i).first()).toBeVisible();
    await expect(page.getByText(/Structure/i).first()).toBeVisible();
    for (const label of ['Score 3', 'Score 4']) {
      const buttons = page.getByRole('button', { name: label });
      const count = await buttons.count();
      for (let i = 0; i < count; i += 1) {
        await buttons.nth(i).click();
      }
    }

    await page.getByRole('button', { name: 'Submit scorecard' }).click();
    await expect(page).toHaveURL(new RegExp(`/interviews/${sessionId}$`));

    // Report shows human-scored results.
    await expect(page.getByRole('heading', { name: 'E2E Human Candidate' })).toBeVisible();
    await expect(page.getByText(/Per-question scores/i)).toBeVisible();
    await expect(page.getByText(/Human/i).first()).toBeVisible();
  });
});

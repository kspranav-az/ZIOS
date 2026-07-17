import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { waitForOtpCode } from './mailpit';

/**
 * Captures review screenshots of the key pages into /tmp/employer-web-shots.
 * Runs the real signup flow once and shoots along the way. The reference
 * design fades/slides content in, so shots wait for animations to settle.
 */

const SHOTS_DIR = '/tmp/employer-web-shots';

async function shoot(page: Page, name: string) {
  // Let entry fade/slide transitions (≤500ms) finish before capturing.
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.png`, fullPage: true });
}

test('capture key pages', async ({ page }) => {
  await mkdir(SHOTS_DIR, { recursive: true });
  const email = `e2e-shots-${Date.now()}@meridian.test`;

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await shoot(page, '01-login');

  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await shoot(page, '02-otp');

  const code = await waitForOtpCode(email);
  await page.getByLabel('Digit 1 of 6').pressSequentially(code);
  await expect(page.getByRole('heading', { name: 'Your workspace is ready' })).toBeVisible();
  await shoot(page, '03-welcome');

  await page.getByRole('button', { name: 'Go to your dashboard' }).click();
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }),
  ).toBeVisible();
  await shoot(page, '04-shell-dashboard');

  await page.goto('/design-system');
  await expect(page.getByRole('heading', { name: 'InterviewOS Design System' })).toBeVisible();
  await shoot(page, '05-design-system');

  await page.goto('/candidates');
  await expect(page.getByRole('heading', { name: 'Candidates', exact: true })).toBeVisible();
  await shoot(page, '06-shell-candidates');
});

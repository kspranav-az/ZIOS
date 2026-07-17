import { expect, test, type Page } from '@playwright/test';
import { waitForOtpCode } from './mailpit';

/**
 * Golden journey (phase-01): signup → workspace, session persistence,
 * logout, wrong-code error, cooldown handling, route guarding.
 * Runs against the real compose stack: api :3000, Mailpit :8025.
 */

function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}@meridian.test`;
}

/** Derives the org name the api will auto-create (domain label, capitalized). */
function expectedOrgName(email: string): string {
  const label = email.split('@')[1]!.split('.')[0]!;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

async function enterEmail(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
}

async function enterCode(page: Page, code: string) {
  // Typing in box 1 auto-advances focus through the boxes.
  await page.getByLabel('Digit 1 of 6').pressSequentially(code);
}

test.describe('auth flow', () => {
  test('signup → workspace → reload stays signed in → logout', async ({ page }) => {
    const email = uniqueEmail('signup');
    await enterEmail(page, email);

    const code = await waitForOtpCode(email);
    await enterCode(page, code);

    // First login → isNewUser → welcome/workspace view with the org name.
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole('heading', { name: 'Your workspace is ready' })).toBeVisible();
    await expect(page.getByText(expectedOrgName(email))).toBeVisible();

    await page.getByRole('button', { name: 'Go to your dashboard' }).click();
    await expect(page).toHaveURL(/\/$/);
    // Shell renders with org name in the topbar and nav in the sidebar.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByLabel('Account menu')).toContainText(expectedOrgName(email));

    // Reload: the httpOnly cookie keeps the session — no login round-trip.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByLabel('Account menu')).toContainText(expectedOrgName(email));

    // Logout: session revoked server-side, back to /login.
    await page.getByRole('button', { name: 'Log Out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    // And protected routes are closed again.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('wrong code shows the INVALID_OTP error and allows retry', async ({ page }) => {
    const email = uniqueEmail('wrongcode');
    await enterEmail(page, email);

    const realCode = await waitForOtpCode(email);
    const wrongCode = realCode === '000000' ? '000001' : '000000';
    await enterCode(page, wrongCode);

    await expect(page.getByRole('alert')).toContainText("That code doesn't match");

    // The boxes cleared — entering the real code now signs in.
    await enterCode(page, realCode);
    await expect(page).toHaveURL(/\/welcome$/);
  });

  test('unauthenticated visit to / redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('requesting a second code immediately hits the cooldown guidance', async ({ page }) => {
    const email = uniqueEmail('cooldown');
    await enterEmail(page, email);

    // Back to the email step and request again within 60s → OTP_COOLDOWN,
    // the app moves the user to the code step with guidance + resend timer.
    await page.getByRole('button', { name: 'Use a different email' }).click();
    await page.getByLabel('Email Address').fill(email);
    await page.getByRole('button', { name: 'Continue with email' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('sent to that address recently');
    await expect(page.getByRole('button', { name: /Resend in/ })).toBeDisabled();
  });

  test('design-system catalog is public and renders tokens + components', async ({ page }) => {
    await page.goto('/design-system');
    await expect(page.getByRole('heading', { name: 'InterviewOS Design System' })).toBeVisible();
    await expect(page.getByText('#003441').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Schedule Interview' })).toBeVisible();
    await expect(page.getByLabel('Digit 1 of 6').first()).toBeVisible();
  });
});

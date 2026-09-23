import { expect, test } from '@playwright/test';
import { waitForOtpCode } from './mailpit';
import { createPublishedKit, signupAdmin } from './helpers';

/**
 * Responsiveness smoke (Phase 12e, Step 4): at a 360px viewport the key
 * employer pages (shell dashboard, kits list, kit builder, JD generation,
 * wallet ledger) must not overflow horizontally.
 */

test.use({ viewport: { width: 360, height: 800 } });

function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}@meridian.test`;
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    m.scrollWidth,
    `horizontal overflow on ${page.url()} (${m.scrollWidth} > ${m.innerWidth})`,
  ).toBeLessThanOrEqual(m.innerWidth + 1);
}

test('no horizontal overflow on the key pages at 360px', async ({ page }) => {
  const email = uniqueEmail('responsive');

  // API-side signup gives us a token to create a kit; the UI login below
  // uses the same account so the SPA session is real.
  const admin = await signupAdmin(email);

  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  const code = await waitForOtpCode(email);
  await page.getByLabel('Digit 1 of 6').pressSequentially(code);
  // First login lands on the workspace/welcome view.
  await page.waitForURL(/welcome|\//);
  await expect(page.getByText('Meridian', { exact: false }).first()).toBeVisible();

  const { kitId } = await createPublishedKit(admin.token);

  for (const path of ['/', '/kits', `/kits/${kitId}`, '/kits/generate', '/settings/wallet']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  }
});

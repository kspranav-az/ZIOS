import { expect, test } from '@playwright/test';
import { candidateEmail, extractOtp, waitForEmail } from './helpers';

/**
 * Responsiveness smoke (Phase 12e, Step 4): at a 360px viewport the key
 * Ascend pages must not overflow horizontally. `min-w-0` on fluid grid/flex
 * children is the load-bearing fix (flex/grid children default to
 * min-width: auto, so wide content forces the track past the viewport and
 * the shell's overflow-x-hidden clips it).
 */

test.use({ viewport: { width: 360, height: 800 } });

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
  const email = candidateEmail();

  // Sign in with an email code (sets the SPA session).
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole('button', { name: /send sign-in code/i }).click();
  const mail = await waitForEmail(email, 'Ascend sign-in code');
  const otp = extractOtp(mail.text);
  const boxes = page.getByRole('textbox');
  for (let i = 0; i < 6; i += 1) {
    await boxes.nth(i).fill(otp[i]!);
  }

  // New user lands on onboarding — fill it so the shell shows all chrome.
  await expect(page.getByLabel(/your name/i)).toBeVisible();
  await page.getByLabel(/your name/i).fill('Responsive Riya');
  await page.getByLabel(/target role/i).fill('Backend Engineer');
  await page
    .getByRole('button', { name: /continue|save|finish/i })
    .first()
    .click();

  for (const path of ['/', '/practice', '/progress', '/wallet']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  }
});

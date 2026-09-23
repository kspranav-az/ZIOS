import { expect, test } from '@playwright/test';
import {
  adminEmail,
  candidateEmail,
  createCandidateInvite,
  createPublishedKit,
  signupAdmin,
} from './helpers';

/**
 * Responsiveness smoke (Phase 12e, Step 4): at a 360px viewport the
 * candidate token landing and consent pages must not overflow horizontally.
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

test('no horizontal overflow on token landing and consent at 360px', async ({ page }) => {
  const admin = await signupAdmin(adminEmail());
  const { versionId } = await createPublishedKit(admin.token, 'text');
  const token = await createCandidateInvite(admin.token, versionId, {
    name: 'Responsive Raj',
    email: candidateEmail(),
  });

  // Token landing (invite verification → consent gate).
  await page.goto(`/${token}`);
  await page.waitForLoadState('networkidle');
  await expectNoHorizontalOverflow(page);

  // Consent page itself (X8 gate).
  const consentCta = page.getByRole('button', { name: /i consent|start|continue|agree/i }).first();
  if (await consentCta.isVisible().catch(() => false)) {
    await expectNoHorizontalOverflow(page);
  }
});

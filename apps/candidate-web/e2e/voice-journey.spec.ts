import { expect, test } from '@playwright/test';
import {
  adminEmail,
  candidateEmail,
  createCandidateInvite,
  createPublishedKit,
  signupAdmin,
} from './helpers';

test('voice invite → consent → voice room → fallback to text', async ({ page }) => {
  const admin = adminEmail();
  const { token: adminToken } = await signupAdmin(admin);
  const { versionId } = await createPublishedKit(adminToken, 'voice');
  const candidate = candidateEmail();
  const rawToken = await createCandidateInvite(adminToken, versionId, {
    name: 'E2E Voice Alice',
    email: candidate,
  });

  await page.goto(`/?token=${rawToken}`);

  // Consent screen.
  await expect(page.getByRole('heading', { name: /Before we begin/i })).toBeVisible();
  await page.getByLabel(/Full name/i).fill('E2E Voice Alice');
  await page.getByLabel(/Email/i).fill(candidate);
  await page.getByRole('button', { name: /I understand and agree/i }).click();

  // Preflight readiness screen.
  await expect(page.getByRole('heading', { name: /Ready to start/i })).toBeVisible();
  await page.getByRole('button', { name: /Start interview/i }).click();

  // Voice interview room should load (WebRTC signalling is best-effort in headless CI).
  await expect(page.getByRole('heading', { name: /Voice interview/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Switch to text/i })).toBeVisible();

  // Fallback to text should land on the text interview page.
  await page.getByRole('button', { name: /Switch to text/i }).click();
  await expect(page.getByRole('heading', { name: /Interview in progress/i })).toBeVisible();
});

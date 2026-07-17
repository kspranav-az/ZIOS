import { expect, test } from '@playwright/test';
import {
  adminEmail,
  candidateEmail,
  createCandidateInvite,
  createPublishedKit,
  signupAdmin,
} from './helpers';

test('reload restores answer draft and interview continues to completion', async ({ page }) => {
  const admin = adminEmail();
  const { token: adminToken } = await signupAdmin(admin);
  const { versionId } = await createPublishedKit(adminToken);
  const candidate = candidateEmail();
  const rawToken = await createCandidateInvite(adminToken, versionId, {
    name: 'E2E Bob',
    email: candidate,
  });

  await page.goto(`/?token=${rawToken}`);

  await expect(page.getByRole('heading', { name: /Before we begin/i })).toBeVisible();
  await page.getByLabel(/Full name/i).fill('E2E Bob');
  await page.getByLabel(/Email/i).fill(candidate);
  await page.getByRole('button', { name: /I understand and agree/i }).click();

  await expect(page.getByRole('heading', { name: /Ready to start/i })).toBeVisible();
  await page.getByRole('button', { name: /Start interview/i }).click();

  await expect(page.getByText(/Tell us about a challenging project/i)).toBeVisible();
  const draft = 'Draft answer that should survive reload.';
  await page.getByLabel(/Your answer/i).fill(draft);

  // Reload the interview page and confirm the draft is restored.
  await page.reload();
  await expect(page.getByText(/Tell us about a challenging project/i)).toBeVisible();
  await expect(page.getByLabel(/Your answer/i)).toHaveValue(draft);

  // Continue answering through to completion.
  await page.getByRole('button', { name: /Submit answer/i }).click();

  await expect(page.getByText(/How do you handle tight deadlines/i)).toBeVisible();
  await page.getByLabel(/Your answer/i).fill('I handle deadlines by prioritising.');
  await page.getByRole('button', { name: /Submit answer/i }).click();

  await expect(page.getByText(/Give a concrete example/i)).toBeVisible();
  await page.getByLabel(/Your answer/i).fill('Concrete example after reload.');
  await page.getByRole('button', { name: /Submit answer/i }).click();

  await expect(page.getByRole('heading', { name: /Thank you/i })).toBeVisible();
});

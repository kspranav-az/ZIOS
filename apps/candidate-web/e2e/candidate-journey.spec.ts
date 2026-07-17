import { expect, test } from '@playwright/test';
import {
  adminEmail,
  candidateEmail,
  createCandidateInvite,
  createPublishedKit,
  signupAdmin,
} from './helpers';

test('full candidate invite → consent → interview → completion flow', async ({ page }) => {
  const admin = adminEmail();
  const { token: adminToken } = await signupAdmin(admin);
  const { versionId } = await createPublishedKit(adminToken);
  const candidate = candidateEmail();
  const rawToken = await createCandidateInvite(adminToken, versionId, {
    name: 'E2E Alice',
    email: candidate,
  });

  await page.goto(`/?token=${rawToken}`);

  // Token landing resolves and lands on consent.
  await expect(page.getByRole('heading', { name: /Before we begin/i })).toBeVisible();
  await expect(page.getByText(/Consent & disclosure/i)).toBeVisible();

  // Confirm identity and accept consent.
  await page.getByLabel(/Full name/i).fill('E2E Alice');
  await page.getByLabel(/Email/i).fill(candidate);
  await page.getByRole('button', { name: /I understand and agree/i }).click();

  // Preflight readiness screen.
  await expect(page.getByRole('heading', { name: /Ready to start/i })).toBeVisible();
  await page.getByRole('button', { name: /Start interview/i }).click();

  // Interview: answer the first question, then the second question and its fixed follow-up.
  await expect(page.getByText(/Tell us about a challenging project/i)).toBeVisible();
  await page.getByLabel(/Your answer/i).fill('I led a migration project with a tight timeline.');
  await page.getByRole('button', { name: /Submit answer/i }).click();

  await expect(page.getByText(/How do you handle tight deadlines/i)).toBeVisible();
  await page.getByLabel(/Your answer/i).fill('I prioritise and communicate blockers early.');
  await page.getByRole('button', { name: /Submit answer/i }).click();

  await expect(page.getByText(/Give a concrete example/i)).toBeVisible();
  await page.getByLabel(/Your answer/i).fill('We refactored the payment module over two sprints.');
  await page.getByRole('button', { name: /Submit answer/i }).click();

  // Completion screen.
  await expect(page.getByRole('heading', { name: /Thank you/i })).toBeVisible();
});

import { expect, test } from '@playwright/test';
import path from 'node:path';
import { candidateEmail, extractOtp, waitForEmail } from './helpers';

/** Real one-page PDF shared with the orchestrator extraction tests. */
const PDF_FIXTURE = path.resolve(
  process.cwd(),
  '../../services/ai-orchestrator/tests/fixtures/tiny-resume.pdf',
);

const RESUME_TEXT = `Priya Sharma
priya.sharma@e2e.example.com | +91 98765 43210

Summary: Backend engineer with 6 years of experience building payment systems.

Skills:
- Python
- PostgreSQL
- Kafka
- AWS

Experience:
Senior Backend Engineer, Zylo Payments (2021 - present)
- Led a team of 5 engineers building the reconciliation service
- Cut processing latency by 40 percent through batching and caching
- Migrated 12 services from VMs to Kubernetes

Education:
B.Tech Computer Science, IIT Delhi, 2018
`;

const JD_TEXT = `Senior Backend Engineer

We are hiring a Senior Backend Engineer to own our payments platform.

Responsibilities:
- Design and operate high-throughput payment APIs
- Mentor a team of engineers

Required skills:
- Python
- PostgreSQL
- Kubernetes
- AWS
- Kafka

Nice to have:
- Terraform
`;

async function login(page: import('@playwright/test').Page): Promise<string> {
  const email = candidateEmail();
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole('button', { name: /send sign-in code/i }).click();
  const mail = await waitForEmail(email, 'Ascend sign-in code');
  const otp = extractOtp(mail.text);
  const boxes = page.getByRole('textbox');
  for (let i = 0; i < 6; i += 1) {
    await boxes.nth(i).fill(otp[i]!);
  }
  await page.getByLabel(/your name/i).fill('E2E Priya');
  await page.getByLabel(/target role/i).fill('Backend Engineer');
  await page.getByRole('button', { name: /continue/i }).first().click();
  await expect(page.getByTestId('wallet-balance')).toHaveText('50');
  return email;
}

test('candidate uploads a resume, sees the ATS card, and runs a JD mock with a gap probe', async ({
  page,
}) => {
  await login(page);

  // --- Resume intelligence ---
  await page.getByRole('button', { name: /resume intelligence/i }).click();
  await expect(page).toHaveURL(/\/resume$/);
  await page.getByLabel(/or paste resume text/i).fill(RESUME_TEXT);
  await page.getByRole('button', { name: /parse resume/i }).click();

  // ATS card renders with a score and at least one issue.
  await expect(page.getByText(/ats readiness/i)).toBeVisible();
  await expect(page.getByText(/parsed profile/i)).toBeVisible();
  await expect(page.getByText(/priya sharma/i).first()).toBeVisible();

  // JD match card.
  await page.getByLabel(/job description/i).fill(JD_TEXT);
  await page.getByRole('button', { name: /analyse match/i }).click();
  await expect(page.getByTestId('match-result')).toBeVisible();
  await expect(page.getByText(/missing:/i)).toContainText(/terraform/i);

  // --- JD-targeted practice mock ---
  await page.goto('/');
  await page.getByRole('button', { name: /start a practice mock/i }).click();
  await expect(page).toHaveURL(/\/practice$/);
  await page.getByLabel(/job description/i).fill(JD_TEXT);
  await page.getByRole('button', { name: /build my mock/i }).click();

  // Consent gate → interview → at least one question mentions the gap or stack.
  await expect(page).toHaveURL(/\/consent$/);
  await page.getByTestId('consent-recording').check();
  await page.getByRole('button', { name: /i consent — start the mock/i }).click();
  await expect(page).toHaveURL(/\/interview$/);
  await expect(page.getByLabel(/your answer/i)).toBeVisible({ timeout: 30_000 });
  // JD-derived question visible (mentions the core stack or the role).
  await expect(
    page.getByText(/python|payments|backend|gap/i).first(),
  ).toBeVisible();
});

test('candidate uploads a PDF resume — extraction, parse, ATS card with no pasting (Phase 12b)', async ({
  page,
}) => {
  await login(page);

  await page.getByRole('button', { name: /resume intelligence/i }).click();
  await expect(page).toHaveURL(/\/resume$/);
  await page.getByTestId('resume-file').setInputFiles(PDF_FIXTURE);

  // The API forwards the bytes to the orchestrator's pypdf port; the parsed
  // profile and ATS card render without the candidate pasting anything.
  await expect(page.getByText(/PDF uploaded/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/on file:/i)).toContainText(/tiny-resume\.pdf/i);
  await expect(page.getByText(/ats readiness/i)).toBeVisible();
  await expect(page.getByText(/parsed profile/i)).toBeVisible();
});

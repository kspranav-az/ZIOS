import { expect, test } from '@playwright/test';
import {
  adminEmail,
  candidateEmail,
  completeInterviewViaApi,
  createCandidateInvite,
  createPublishedKit,
  signupAdmin,
} from './helpers';

/**
 * Phase 04 golden journey: employer views the interview pipeline, opens an
 * evidence-linked report, overrides a score, downloads a PDF, and shares a
 * public link that renders in an incognito context.
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

test.describe('report dashboard', () => {
  test('pipeline → report → override → PDF → share link', async ({ page, browser }) => {
    // 1. Backend setup: admin, kit, invite, complete interview via API.
    const admin = adminEmail();
    const { token: adminToken } = await signupAdmin(admin);
    const { versionId } = await createPublishedKit(adminToken);
    const candidate = candidateEmail();
    const rawToken = await createCandidateInvite(adminToken, versionId, {
      name: 'E2E Candidate',
      email: candidate,
    });

    const { sessionId } = await completeInterviewViaApi(
      rawToken,
      {
        name: 'E2E Candidate',
        email: candidate,
      },
      [
        'I led a migration project with a tight timeline and cross-functional stakeholders.',
        'I prioritise and communicate blockers early to keep delivery predictable.',
        'We refactored the payment module over two sprints while keeping daily standups focused.',
      ],
    );

    // 2. Sign in as admin (cookie from API token) and navigate to pipeline.
    await signInAsAdminWithToken(page, adminToken);
    await page.goto('/interviews');
    await expect(page.getByRole('heading', { name: 'Interviews' })).toBeVisible();

    const row = page.getByRole('row', { name: /E2E Candidate/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText(candidate);

    // 3. Open report detail and assert scores + evidence.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/interviews/${sessionId}$`));
    await expect(page.getByRole('heading', { name: 'E2E Candidate' })).toBeVisible();
    await expect(page.getByText(/Overall recommendation/i)).toBeVisible();
    await expect(page.getByText(/Per-question scores/i)).toBeVisible();
    await expect(page.getByText(/Evidence/i).first()).toBeVisible();

    // 4. Override a score with a reason code.
    const firstOverrideButton = page.getByRole('button', { name: 'Override' }).first();
    await firstOverrideButton.click();
    await expect(page.getByRole('heading', { name: 'Override score' })).toBeVisible();
    await page.getByRole('button', { name: '2' }).click();
    await page.getByLabel(/Reason code/i).fill('disagree_with_evidence');
    await page.getByRole('button', { name: 'Save override' }).click();
    await expect(page.getByText(/Overridden/i).first()).toBeVisible();

    // 5. Download PDF.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/report-.*\.pdf$/);

    // 6. Create share link and open in incognito context.
    await page.getByRole('button', { name: 'Share' }).click();
    const shareUrl = await page.locator('p.font-mono').textContent();
    expect(shareUrl).toMatch(/\/share\//);

    const incognito = await browser.newContext();
    const publicPage = await incognito.newPage();
    await publicPage.goto(shareUrl!);
    await expect(
      publicPage.getByRole('heading', { name: 'Shared interview report' }),
    ).toBeVisible();
    await expect(publicPage.getByText(/Overall recommendation/i)).toBeVisible();
    await expect(publicPage.getByText(/Per-question scores/i)).toBeVisible();
    await incognito.close();
  });
});

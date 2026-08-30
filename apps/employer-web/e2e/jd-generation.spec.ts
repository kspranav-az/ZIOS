import { expect, test } from '@playwright/test';
import { adminEmail, postJson, signupAdmin } from './helpers';

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

const SAMPLE_JD = `Senior Backend Engineer

We are looking for a senior backend engineer to design, build and operate the services that power our hiring platform. You will work in a cross-functional squad with product managers, designers and other engineers to ship reliable, scalable software.

Responsibilities:
- Design and implement RESTful and event-driven APIs in TypeScript and Node.js.
- Own data modeling, query performance and schema evolution in PostgreSQL.
- Build observable systems using structured logging, metrics and tracing.
- Collaborate on architecture decisions and mentor junior engineers.
- Maintain high test coverage and participate in code review.

Required skills:
- TypeScript, Node.js, PostgreSQL
- AWS or GCP
- Docker, Kubernetes, Terraform
- Strong communication and problem solving`;

/**
 * Phase 05 golden journey: paste a JD, review the generated proposal, edit two
 * fields, regenerate one question, and publish the kit.
 */
test.describe('JD generation', () => {
  test('JD → proposal → review → publish', async ({ page }) => {
    // 1. Backend setup: create an admin via API.
    const admin = adminEmail();
    const { token: adminToken } = await signupAdmin(admin);

    // 2. Generate a proposal via API so we can land directly on review.
    const proposeResponse = await postJson(
      '/generation/propose',
      { jdText: SAMPLE_JD },
      { authorization: `Bearer ${adminToken}` },
    );
    if (!proposeResponse.ok) {
      throw new Error(`propose failed: ${proposeResponse.status} ${await proposeResponse.text()}`);
    }
    const proposeBody = (await proposeResponse.json()) as {
      generation: { id: string };
      profile: { title: string | null };
      proposal: { topics: string[]; questions: Array<{ prompt: string }> };
    };
    const generationId = proposeBody.generation.id;

    // 3. Sign in as admin and open the review screen.
    await signInAsAdminWithToken(page, adminToken);
    await page.goto(`/kits/generate/${generationId}/review`);

    await expect(page.getByRole('heading', { name: /Review generated kit/i })).toBeVisible();
    await expect(page.getByText(/Extracted role profile/i)).toBeVisible();

    // The stub extractor should surface a title.
    const titleText = proposeBody.profile.title ?? 'Senior Backend Engineer';
    await expect(page.getByText(titleText)).toBeVisible();

    // 4. Regenerate a question first so later edits survive publish.
    const regenerateButtons = page.getByRole('button', { name: /Regenerate this question/i });
    await regenerateButtons.first().click();
    await expect(page.getByRole('button', { name: /Regenerate this question/i })).toHaveCount(
      proposeBody.proposal.questions.length,
    );

    // 5. Edit two fields on the proposal.
    const firstPrompt = page.locator('textarea[id^="prompt-"]').first();
    await expect(firstPrompt).toBeVisible();
    await firstPrompt.fill('Edited prompt for the first generated question.');

    const firstTopic = page.locator('input[id^="topic-"]').first();
    await firstTopic.fill('Edited Topic');

    // 6. Confirm review and publish.
    const publishPromise = page.waitForRequest((req) =>
      req.url().includes(`/generation/${generationId}/publish`),
    );
    await page.getByLabel(/I have reviewed this AI-generated proposal/i).check();
    await page.getByRole('button', { name: /Publish kit/i }).click();
    const publishReq = await publishPromise;
    const publishBody = (await publishReq.postDataJSON()) as {
      proposal?: { questions?: Array<{ prompt: string; topic: string }> };
    };
    const firstQuestionBody = publishBody.proposal?.questions?.[0];
    expect(firstQuestionBody?.prompt).toBe('Edited prompt for the first generated question.');
    expect(firstQuestionBody?.topic).toBe('Edited Topic');

    // 7. Assert navigation to the new kit builder and that edits persisted.
    await expect(page).toHaveURL(/\/kits\/.+$/);
    const firstQuestion = page.locator('[data-question-id]').first();
    await expect(firstQuestion).toBeVisible();
    await expect(
      firstQuestion.getByText('Edited prompt for the first generated question.'),
    ).toBeVisible();
    // Topic is stored in a collapsed input; verify its value by expanding the card.
    await firstQuestion.getByRole('button', { name: /Expand question 1/i }).click();
    await expect(firstQuestion.locator('input[id^="topic-"]').first()).toHaveValue('Edited Topic');
  });
});

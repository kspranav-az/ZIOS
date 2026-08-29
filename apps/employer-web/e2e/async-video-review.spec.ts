import { expect, test } from '@playwright/test';
import { adminEmail, candidateEmail, signupAdmin } from '../../candidate-web/e2e/helpers';
import {
  cleanupRoleQuestions,
  consentAsyncVideoByToken,
  createAsyncVideoInterview,
  seedAsyncVideoAnswers,
  seedRoleQuestions,
} from '../../candidate-web/e2e/async-video-helpers';

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

test.describe('async video review', () => {
  const roleId = Math.floor(Math.random() * 1_000_000);
  const roleName = `E2E Async Role ${roleId}`;

  test.beforeAll(async () => {
    await seedRoleQuestions(roleId, roleName);
  });

  test.afterAll(async () => {
    await cleanupRoleQuestions(roleName);
  });

  test('employer reviews recorded answers, transcripts, and submits per-question scores', async ({
    page,
  }) => {
    const admin = adminEmail();
    const { token: adminToken } = await signupAdmin(admin);
    const candidate = candidateEmail();

    const created = await createAsyncVideoInterview(
      adminToken,
      roleId,
      { name: 'E2E Async Candidate', email: candidate },
      { enableTranscription: true },
    );

    // Candidate consents and records both answers.
    const { recoveryToken } = await consentAsyncVideoByToken(created.token, {
      name: 'E2E Async Candidate',
      email: candidate,
    });
    await seedAsyncVideoAnswers(created, recoveryToken);

    await signInAsAdminWithToken(page, adminToken);
    await page.goto(`/interviews/${created.sessionId}/async-review`);

    // Page loads candidate info and both questions.
    await expect(page.getByText('E2E Async Candidate')).toBeVisible();
    await expect(page.getByText(candidate)).toBeVisible();
    await expect(page.getByText(/Async video review/i)).toBeVisible();
    await expect(
      page.getByText(/Tell us about a time you led a project under pressure/i),
    ).toBeVisible();
    await expect(
      page.getByText(/How do you debug a production issue you cannot reproduce locally/i),
    ).toBeVisible();

    // Each question has a video player and a transcript.
    const videos = page.locator('video');
    await expect(videos).toHaveCount(2);
    await expect(page.getByText(/placeholder transcript/i).first()).toBeVisible();

    // Score the first question.
    const firstQuestionCard = page.getByTestId('async-video-question-card').first();
    await firstQuestionCard.getByRole('button', { name: 'Score 4' }).scrollIntoViewIfNeeded();
    await firstQuestionCard.getByRole('button', { name: 'Score 4' }).click();
    await firstQuestionCard.locator('textarea').fill('Strong, concrete example.');
    await firstQuestionCard.getByRole('button', { name: 'Save score' }).click();

    // Score the second question.
    const secondQuestionCard = page.getByTestId('async-video-question-card').nth(1);
    await secondQuestionCard.getByRole('button', { name: 'Score 3' }).scrollIntoViewIfNeeded();
    await secondQuestionCard.getByRole('button', { name: 'Score 3' }).click();
    await secondQuestionCard.locator('textarea').fill('Good process, light on tools.');
    await secondQuestionCard.getByRole('button', { name: 'Save score' }).click();

    // Refresh and verify persistence.
    await page.reload();
    await expect(firstQuestionCard.getByRole('button', { name: 'Score 4' })).toHaveClass(
      /bg-primary/,
    );
    await expect(secondQuestionCard.getByRole('button', { name: 'Score 3' })).toHaveClass(
      /bg-primary/,
    );
    await expect(firstQuestionCard.locator('textarea')).toHaveValue('Strong, concrete example.');
    await expect(secondQuestionCard.locator('textarea')).toHaveValue(
      'Good process, light on tools.',
    );
  });
});

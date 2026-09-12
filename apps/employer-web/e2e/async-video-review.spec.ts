import { expect, test } from '@playwright/test';
import { adminEmail, candidateEmail, signupAdmin } from '../../candidate-web/e2e/helpers';
import {
  cleanupRoleQuestions,
  consentAsyncVideoByToken,
  createAsyncVideoInterview,
  seedAsyncVideoAnswers,
  seedCredits,
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
    const { token: adminToken, orgId } = await signupAdmin(admin);
    await seedCredits(orgId);
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
    await seedAsyncVideoAnswers(created, recoveryToken, { waitForTranscription: true });

    // Stub the Phase 14 features endpoint (no real analysis job runs in e2e).
    // The panel must render the stubbed measurements per question.
    await page.route('**/analysis/sessions/*/questions/*/features', async (route) => {
      const url = route.request().url();
      const questionId = url.split('/questions/')[1]?.split('/')[0] ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: created.sessionId,
          questionId,
          analysisJobId: 'e2e-analysis-job',
          schemaVersion: '1.0.0',
          features: {
            schema_version: '1.0.0',
            session_id: created.sessionId,
            question_id: questionId,
            media_kind: 'video',
            visual: { camera_gaze_ratio: { value: 0.87, valid: true } },
            body: {},
            hands: {},
            speech: {
              wpm_mean: { value: 146, valid: true },
              filler_count: { value: 7, valid: true, heuristic: true },
            },
            voice: { pitch_mean: { value: 118, valid: true } },
            interaction: {
              talk_ratio: { value: null, valid: false, reason: 'single_speaker_recording' },
            },
            quality: {},
          },
          media: null,
          completedAt: null,
        }),
      });
    });

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
    // The mock STT fixture produces this deterministic final transcript.
    await expect(
      page.getByText(/most challenging part was aligning the team/i).first(),
    ).toBeVisible();

    // The analysis features panel renders the stubbed measurements.
    const firstFeaturesPanel = page.getByTestId('analysis-features').first();
    await expect(firstFeaturesPanel.getByText('Analysis measurements')).toBeVisible();
    await firstFeaturesPanel.getByRole('button', { name: 'Speech' }).click();
    await expect(firstFeaturesPanel.getByText('146 wpm')).toBeVisible();
    await expect(firstFeaturesPanel.getByText('heuristic')).toBeVisible();
    await firstFeaturesPanel.getByRole('button', { name: 'Interaction' }).click();
    await expect(firstFeaturesPanel.getByText('n/a — Single speaker recording')).toBeVisible();

    // Use AI pre-fill to populate suggested scores from the stub judge.
    await page.getByRole('button', { name: /Generate AI pre-fill/i }).click();
    await expect(page.getByText(/AI pre-fill applied/i)).toBeVisible();

    // Edit one pre-filled score to verify human override tracking.
    const firstQuestionCard = page.getByTestId('async-video-question-card').first();
    await firstQuestionCard.getByRole('button', { name: 'Score 4' }).scrollIntoViewIfNeeded();
    await firstQuestionCard.getByRole('button', { name: 'Score 4' }).click();
    await firstQuestionCard.locator('textarea').fill('Strong, concrete example.');
    await firstQuestionCard.getByRole('button', { name: 'Save score' }).click();

    // Ensure the second question also has a score (from pre-fill or manual).
    const secondQuestionCard = page.getByTestId('async-video-question-card').nth(1);
    await secondQuestionCard.getByRole('button', { name: 'Score 3' }).scrollIntoViewIfNeeded();
    await secondQuestionCard.getByRole('button', { name: 'Score 3' }).click();
    await secondQuestionCard.locator('textarea').fill('Good process, light on tools.');
    await secondQuestionCard.getByRole('button', { name: 'Save score' }).click();

    // Submit the scorecard and land on the standard report page.
    await page.getByRole('button', { name: /Submit scorecard/i }).click();
    await expect(page).toHaveURL(`/interviews/${created.sessionId}`);
    await expect(page.getByText(/Overall recommendation/i)).toBeVisible();
    await expect(page.getByText(/Strong, concrete example./i)).toBeVisible();
    await expect(page.getByText(/Good process, light on tools./i)).toBeVisible();

    // Refresh and verify persistence.
    await page.goto(`/interviews/${created.sessionId}/async-review`);
    await expect(firstQuestionCard.getByRole('button', { name: 'Score 4' })).toHaveClass(
      /bg-primary/,
    );
    await expect(firstQuestionCard.locator('textarea')).toHaveValue('Strong, concrete example.');
  });
});

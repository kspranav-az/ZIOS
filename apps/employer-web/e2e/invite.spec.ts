import { expect, test, type Page } from '@playwright/test';
import { waitForInviteToken, waitForOtpCode } from './mailpit';

/**
 * FR-E1-3 invite journey: admin invites a teammate → invite email (Mailpit)
 * → accept link → INVITE_EMAIL_MISMATCH for the wrong signed-in email →
 * sign in with the invited email → auto-accept → land in the inviter's org.
 */

function uniqueEmail(tag: string, domain: string): string {
  return `e2e-${tag}-${Date.now()}@${domain}`;
}

function expectedOrgName(email: string): string {
  const label = email.split('@')[1]!.split('.')[0]!;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

async function signUpThroughUi(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const code = await waitForOtpCode(email);
  await page.getByLabel('Digit 1 of 6').pressSequentially(code);
}

test('invite: mismatch guidance, then accept lands the invitee in the inviter org', async ({
  page,
}) => {
  // Distinct domains: the inviter's org (from their domain) must be provably
  // different from the org the invitee's own signup would auto-create.
  const adminEmail = uniqueEmail('admin', 'acme.test');
  const inviteeEmail = uniqueEmail('invitee', 'person.test');
  const orgName = expectedOrgName(adminEmail);

  // 1. Admin signs up (auto-created org, admin role) and reaches the shell.
  await signUpThroughUi(page, adminEmail);
  await expect(page.getByRole('heading', { name: 'Your workspace is ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to your dashboard' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  // 2. Admin invites the teammate from the dashboard quick action.
  await page.getByRole('button', { name: 'Invite Team Member' }).click();
  await page.getByLabel('Email Address').fill(inviteeEmail);
  await page.getByLabel('Role').selectOption('interviewer');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(`Invite sent to ${inviteeEmail}`)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  const token = await waitForInviteToken(inviteeEmail);

  // 3. Still signed in as the admin: opening the accept link shows the
  //    INVITE_EMAIL_MISMATCH guidance (invite is for a different email).
  await page.goto(`/accept-invite?token=${encodeURIComponent(token)}`);
  await expect(
    page.getByRole('heading', { name: 'This invite is for a different email' }),
  ).toBeVisible();
  await expect(page.getByText(adminEmail)).toBeVisible();

  // 4. Follow the recovery path: sign out, sign in with the invited email.
  await page.getByRole('button', { name: 'Sign in with the invited email' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.getByLabel('Email Address').fill(inviteeEmail);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const code = await waitForOtpCode(inviteeEmail);
  await page.getByLabel('Digit 1 of 6').pressSequentially(code);

  // 5. The invitee is new (isNewUser) but the pending invite wins: they land
  //    back on /accept-invite and the accept retried automatically.
  await expect(page.getByRole('heading', { name: "You're in!" })).toBeVisible();
  await expect(page.getByText(`You've joined ${orgName}.`)).toBeVisible();

  // 6. Continue → the shell now shows the INVITER's org and the invited role.
  await page.getByRole('button', { name: 'Continue to dashboard' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByLabel('Account menu')).toContainText(`Interviewer · ${orgName}`);
});

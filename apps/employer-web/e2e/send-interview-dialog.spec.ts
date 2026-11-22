import { expect, test } from '@playwright/test';

/**
 * Regression: the Send-interview dialog must fit inside the viewport.
 * A `transform` on the AppShell content wrapper made it the containing
 * block for fixed-position dialogs, so the dialog centered against the
 * full page height and was clipped top/bottom (fixed 2026-11-23).
 */
const API = process.env.VITE_API_URL ?? 'http://localhost:3000';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

async function loginViaOtp(page: import('@playwright/test').Page, email: string) {
  const otpRes = await page.request.post(`${API}/auth/otp/request`, { data: { email } });
  expect(otpRes.ok()).toBeTruthy();
  await page.waitForTimeout(1200);
  const list = (await (await page.request.get(`${MAILPIT}/api/v1/messages?limit=10`)).json()) as {
    messages: Array<{ ID: string; To: Array<{ Address: string }> }>;
  };
  const mine = list.messages.find((m) => m.To[0]?.Address === email);
  if (!mine) throw new Error(`no otp mail for ${email}`);
  const full = (await (
    await page.request.get(`${MAILPIT}/api/v1/message/${mine.ID}`)
  ).json()) as { Text?: string };
  const code = (full.Text ?? '').match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error('no otp code in mail');
  const verify = await page.request.post(`${API}/auth/otp/verify`, { data: { email, code } });
  expect(verify.ok()).toBeTruthy();
}

test('send-interview dialog fits inside the viewport', async ({ page }) => {
  const email = `dlg-${Date.now()}@local.test`;
  await loginViaOtp(page, email);

  await page.goto('/candidates', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /send interview/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const metrics = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
  });
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.vh);
  await page.screenshot({ path: 'test-results/send-interview-dialog.png' });
});

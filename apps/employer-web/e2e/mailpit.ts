/**
 * Reads OTP codes from Mailpit's HTTP API (compose service, UI on :8025).
 * No credentials needed — Mailpit is the dev EmailSender binding (ADR-0002).
 */

const MAILPIT_API = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';

interface MailpitMessageSummary {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
  Created: string;
}

interface MailpitMessageList {
  messages: MailpitMessageSummary[];
}

interface MailpitMessageDetail {
  ID: string;
  Text: string;
}

async function listMessages(): Promise<MailpitMessageSummary[]> {
  const response = await fetch(`${MAILPIT_API}/api/v1/messages?limit=50`);
  if (!response.ok) throw new Error(`Mailpit list failed: HTTP ${response.status}`);
  const body = (await response.json()) as MailpitMessageList;
  return body.messages ?? [];
}

/**
 * Polls Mailpit until the newest email to `email` contains a 6-digit code.
 * Times out after `timeoutMs`.
 */
export async function waitForOtpCode(email: string, timeoutMs = 15_000): Promise<string> {
  return waitForMatch(email, extractCode, timeoutMs, 'OTP');
}

/**
 * Polls Mailpit until the newest email to `email` contains an
 * /accept-invite?token=… link; returns the raw token (URL-decoded).
 */
export async function waitForInviteToken(email: string, timeoutMs = 15_000): Promise<string> {
  return waitForMatch(email, extractInviteToken, timeoutMs, 'invite');
}

/** Extracts the first 6-digit code from a message body. */
function extractCode(text: string): string | null {
  const match = text.match(/\b(\d{6})\b/);
  return match ? match[1]! : null;
}

function extractInviteToken(text: string): string | null {
  const match = text.match(/\/accept-invite\?token=([^\s]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

async function waitForMatch(
  email: string,
  extract: (text: string) => string | null,
  timeoutMs: number,
  kind: string,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const normalized = email.toLowerCase();

  while (Date.now() < deadline) {
    const messages = await listMessages();
    // Newest first, only messages addressed to the target recipient.
    const matches = messages
      .filter((message) => message.To.some((to) => to.Address.toLowerCase() === normalized))
      .sort((a, b) => b.Created.localeCompare(a.Created));

    for (const match of matches) {
      const response = await fetch(`${MAILPIT_API}/api/v1/message/${match.ID}`);
      if (!response.ok) continue;
      const detail = (await response.json()) as MailpitMessageDetail;
      const value = extract(detail.Text ?? '');
      if (value) return value;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No ${kind} email for ${email} found in Mailpit within ${timeoutMs}ms`);
}

import { randomUUID } from 'node:crypto';

export const API_BASE = 'http://localhost:3000';
export const MAILPIT_API = 'http://localhost:8025';

export function candidateEmail(): string {
  return `e2e-candidate-${randomUUID().slice(0, 8)}@ascend-e2e.local`;
}

export async function waitForEmail(
  to: string,
  subjectIncludes: string,
  options: { timeoutMs?: number } = {},
): Promise<{ id: string; subject: string; text: string }> {
  const { timeoutMs = 20000 } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listRes = await fetch(`${MAILPIT_API}/api/v1/messages?limit=50`);
    const list = (await listRes.json()) as {
      messages?: Array<{ ID: string; To: Array<{ Address: string }>; Subject: string }>;
    };
    const hit = (list.messages ?? []).find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()) &&
        m.Subject.includes(subjectIncludes),
    );
    if (hit) {
      const detailRes = await fetch(`${MAILPIT_API}/api/v1/message/${hit.ID}`);
      const detail = (await detailRes.json()) as { Subject: string; Text: string };
      return { id: hit.ID, subject: detail.Subject, text: detail.Text ?? '' };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no email to ${to} with subject containing "${subjectIncludes}" arrived`);
}

export function extractOtp(text: string): string {
  const match = /(\d{6})/.exec(text);
  if (!match?.[1]) {
    throw new Error(`no 6-digit code found in email text:\n${text}`);
  }
  return match[1];
}

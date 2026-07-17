import { randomUUID } from 'node:crypto';

export const API_BASE = 'http://localhost:3000';
export const MAILPIT_API = 'http://localhost:8025';

export function adminEmail(): string {
  return `e2e-admin-${randomUUID().slice(0, 8)}@candidate-e2e.local`;
}

export function candidateEmail(): string {
  return `e2e-candidate-${randomUUID().slice(0, 8)}@candidate-e2e.local`;
}

export async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export async function waitForEmail(
  to: string,
  subjectIncludes: string,
  options: { timeoutMs?: number; excludeIds?: string[] } = {},
): Promise<{ id: string; subject: string; text: string }> {
  const { timeoutMs = 15000, excludeIds = [] } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listRes = await fetch(`${MAILPIT_API}/api/v1/messages?limit=50`);
    const list = (await listRes.json()) as {
      messages?: Array<{ ID: string; To: Array<{ Address: string }>; Subject: string }>;
    };
    const hit = (list.messages ?? []).find(
      (m) =>
        !excludeIds.includes(m.ID) &&
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

export async function signupAdmin(email: string): Promise<{ token: string }> {
  const request = await postJson('/auth/otp/request', { email });
  if (!request.ok) {
    throw new Error(`admin otp request failed: ${request.status} ${await request.text()}`);
  }
  const mail = await waitForEmail(email, 'sign-in code');
  const code = extractOtp(mail.text);
  const verify = await postJson('/auth/otp/verify', { email, code });
  if (!verify.ok) {
    throw new Error(`admin otp verify failed: ${verify.status} ${await verify.text()}`);
  }
  const body = (await verify.json()) as { session: { token: string } };
  return { token: body.session.token };
}

export async function createPublishedKit(
  adminToken: string,
  mode: 'text' | 'voice' | 'video' = 'text',
  proctoringLevel: 'none' | 'standard' | 'strict' = 'none',
): Promise<{ kitId: string; versionId: string }> {
  const create = await postJson(
    '/kits',
    {
      title: `E2E Candidate Kit ${mode}`,
      role: 'Engineer',
      level: 'Mid',
      settings: { mode, proctoringLevel },
    },
    { authorization: `Bearer ${adminToken}` },
  );
  if (!create.ok) {
    throw new Error(`create kit failed: ${create.status} ${await create.text()}`);
  }
  const { kit } = (await create.json()) as { kit: { id: string } };

  const q1 = {
    type: 'open_ended',
    prompt: 'Tell us about a challenging project.',
    topic: 'Experience',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [{ id: randomUUID(), text: 'Clarity', weight: 1 }],
  };
  const q2 = {
    type: 'open_ended',
    prompt: 'How do you handle tight deadlines?',
    topic: 'Behaviour',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'fixed',
    followupFixed: ['Give a concrete example.'],
    rubricLines: [{ id: randomUUID(), text: 'Structure', weight: 1 }],
  };

  for (const q of [q1, q2]) {
    const add = await postJson(`/kits/${kit.id}/questions`, q, {
      authorization: `Bearer ${adminToken}`,
    });
    if (!add.ok) {
      throw new Error(`add question failed: ${add.status} ${await add.text()}`);
    }
  }

  const publish = await postJson(`/kits/${kit.id}/publish`, undefined, {
    authorization: `Bearer ${adminToken}`,
  });
  if (!publish.ok) {
    throw new Error(`publish kit failed: ${publish.status} ${await publish.text()}`);
  }
  const { version } = (await publish.json()) as { version: { id: string } };
  return { kitId: kit.id, versionId: version.id };
}

export async function createCandidateInvite(
  adminToken: string,
  versionId: string,
  candidate: { name: string; email: string },
): Promise<string> {
  const invite = await postJson(
    '/invites',
    { kitVersionId: versionId, candidate },
    { authorization: `Bearer ${adminToken}` },
  );
  if (!invite.ok) {
    throw new Error(`create invite failed: ${invite.status} ${await invite.text()}`);
  }
  const body = (await invite.json()) as { token: string };
  return body.token;
}

import { randomUUID } from 'node:crypto';
import {
  adminEmail,
  candidateEmail,
  createCandidateInvite,
  createPublishedKit,
  postJson,
  signupAdmin,
} from '../../candidate-web/e2e/helpers';

export {
  adminEmail,
  candidateEmail,
  createCandidateInvite,
  createPublishedKit,
  postJson,
  signupAdmin,
};

export async function resolveInviteToken(token: string): Promise<{
  session: { id: string } | null;
}> {
  const response = await fetch(
    `http://localhost:3000/invites/by-token/${encodeURIComponent(token)}`,
  );
  if (!response.ok) {
    throw new Error(`resolve invite failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as { session: { id: string } | null };
}

export async function consentByToken(
  token: string,
  body: { name: string; email: string },
): Promise<{ session: { id: string }; recoveryToken: string }> {
  const response = await postJson(`/invites/by-token/${encodeURIComponent(token)}/consent`, body);
  if (!response.ok) {
    throw new Error(`consent failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as { session: { id: string }; recoveryToken: string };
}

export async function completeInterviewViaApi(
  rawToken: string,
  candidate: { name: string; email: string },
  answers: string[],
): Promise<{ sessionId: string }> {
  const { recoveryToken } = await consentByToken(rawToken, candidate);
  const { session } = await resolveInviteToken(rawToken);
  if (!session) {
    throw new Error('session not created after consent');
  }
  const sessionId = session.id;

  // Preflight presents the first question.
  const preflight = await postJson(
    `/sessions/${sessionId}/preflight`,
    {},
    { 'x-recovery-token': recoveryToken },
  );
  if (!preflight.ok) {
    throw new Error(`preflight failed: ${preflight.status} ${await preflight.text()}`);
  }

  for (const answer of answers) {
    const turn = await postJson(
      `/sessions/${sessionId}/turn`,
      { answer },
      { 'x-recovery-token': recoveryToken },
    );
    if (!turn.ok) {
      throw new Error(`turn failed: ${turn.status} ${await turn.text()}`);
    }
    const turnBody = (await turn.json()) as { session: { status: string }; turn: { type: string } };
    if (turnBody.turn.type === 'wrapup') {
      break;
    }
  }

  return { sessionId };
}

export function uniqueTag(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

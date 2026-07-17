import { randomUUID } from 'node:crypto';
import {
  adminEmail,
  API_BASE,
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

export async function scheduleInterview(
  adminToken: string,
  inviteId: string,
  slotAt: Date,
): Promise<void> {
  const response = await postJson(
    `/invites/${encodeURIComponent(inviteId)}/schedule`,
    {
      slotAt: slotAt.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      interviewerIds: [],
    },
    { authorization: `Bearer ${adminToken}` },
  );
  if (!response.ok) {
    throw new Error(`schedule failed: ${response.status} ${await response.text()}`);
  }
}

export async function createHumanSession(
  adminToken: string,
  candidate: { name: string; email: string },
): Promise<{ inviteId: string; sessionId: string; recoveryToken: string; token: string }> {
  const { versionId } = await createPublishedKit(adminToken, 'video', 'none');
  const token = await createCandidateInvite(adminToken, versionId, candidate, 'human');
  const { recoveryToken } = await consentByToken(token, candidate);
  const { session } = await resolveInviteToken(token);
  if (!session) {
    throw new Error('session not created after consent');
  }
  const inviteResponse = await fetch(`${API_BASE}/invites/by-token/${encodeURIComponent(token)}`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (!inviteResponse.ok) {
    throw new Error(`resolve invite id failed: ${inviteResponse.status}`);
  }
  const inviteBody = (await inviteResponse.json()) as { invite: { id: string } };
  return { inviteId: inviteBody.invite.id, sessionId: session.id, recoveryToken, token };
}

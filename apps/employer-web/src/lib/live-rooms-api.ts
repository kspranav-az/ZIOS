import type {
  CockpitStateResponse,
  HumanScorecardBody,
  LiveTokenResponse,
  MarkCoverageBody,
  ReportDetailResponse,
  RescheduleRequestBody,
  ScheduleSlotBody,
  ScheduleSlotResponse,
} from '@zios/shared-types';
import { apiFetch } from './api';

export function scheduleSlot(
  inviteId: string,
  body: ScheduleSlotBody,
): Promise<ScheduleSlotResponse> {
  return apiFetch(`/invites/${encodeURIComponent(inviteId)}/schedule`, {
    method: 'POST',
    json: body,
  });
}

export function requestReschedule(
  token: string,
  body: RescheduleRequestBody,
): Promise<{ slot: import('@zios/shared-types').InterviewSlot }> {
  return apiFetch(`/invites/by-token/${encodeURIComponent(token)}/reschedule-request`, {
    method: 'POST',
    json: body,
  });
}

export function getCockpitState(sessionId: string): Promise<CockpitStateResponse> {
  return apiFetch(`/sessions/${encodeURIComponent(sessionId)}/live/cockpit`);
}

export function markCoverage(
  sessionId: string,
  body: MarkCoverageBody,
): Promise<{ coverage: import('@zios/shared-types').SessionCoverage[] }> {
  return apiFetch(`/sessions/${encodeURIComponent(sessionId)}/live/coverage`, {
    method: 'POST',
    json: body,
  });
}

export function endLiveCall(
  sessionId: string,
): Promise<{ session: { status: string }; reportId: string }> {
  return apiFetch(`/sessions/${encodeURIComponent(sessionId)}/live/end`, { method: 'POST' });
}

export function issueInterviewerToken(sessionId: string): Promise<LiveTokenResponse> {
  return apiFetch(`/sessions/${encodeURIComponent(sessionId)}/live/interviewer-token`, {
    method: 'POST',
  });
}

export function prefillScorecard(sessionId: string): Promise<ReportDetailResponse> {
  return apiFetch(`/reports/${encodeURIComponent(sessionId)}/scorecard/prefill`, {
    method: 'POST',
  });
}

export function submitScorecard(
  sessionId: string,
  body: HumanScorecardBody,
): Promise<ReportDetailResponse> {
  return apiFetch(`/reports/${encodeURIComponent(sessionId)}/scorecard`, {
    method: 'POST',
    json: body,
  });
}

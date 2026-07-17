import { Injectable } from '@nestjs/common';
import type {
  AppUser,
  CockpitStateResponse,
  InterviewNotes,
  InterviewSlot,
  KitSnapshot,
  LiveEndResponse,
  LiveTokenResponse,
  MarkCoverageBody,
  RescheduleRequestBody,
  ScheduleSlotBody,
  SessionCoverage,
} from '@zios/shared-types';
import { issueLiveKitToken } from '@/common/livekit-token';
import { ApiException } from '@/common/errors';
import { TokenService } from '@/common/tokens';
import { CandidatesRepository } from '@/modules/candidates';
import { DatabaseService, type Queryable } from '@/modules/database';
import { EvaluationService } from '@/modules/evaluation';
import { KitVersionsRepository } from '@/modules/kits';
import { SessionsRepository } from '@/modules/sessions';
import { TranscriptRepository } from '@/modules/sessions/transcript.repository';
import { CoverageRepository } from './coverage.repository';
import { InterviewSlotRepository } from './slot.repository';
import { NotesService } from './notes.service';

const WINDOW_MINUTES = 10;

@Injectable()
export class LiveRoomsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly slots: InterviewSlotRepository,
    private readonly coverage: CoverageRepository,
    private readonly sessions: SessionsRepository,
    private readonly transcript: TranscriptRepository,
    private readonly candidates: CandidatesRepository,
    private readonly kitVersions: KitVersionsRepository,
    private readonly evaluation: EvaluationService,
    private readonly notes: NotesService,
  ) {}

  /* ---- scheduling ---- */

  async schedule(
    orgId: string,
    inviteId: string,
    body: ScheduleSlotBody,
  ): Promise<{ slot: InterviewSlot }> {
    const slotAt = new Date(body.slotAt);
    if (Number.isNaN(slotAt.getTime())) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'slotAt is not a valid date');
    }
    return this.db.transaction(async (q) => {
      const invite = await q.query(
        'SELECT id, candidate_id FROM invite WHERE id = $1 AND org_id = $2',
        [inviteId, orgId],
      );
      if (invite.rows.length === 0) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      const sessionRes = await q.query(
        'SELECT id FROM interview_session WHERE invite_id = $1 ORDER BY created_at DESC LIMIT 1',
        [inviteId],
      );
      const sessionId = (sessionRes.rows[0] as { id: string } | undefined)?.id ?? null;
      const slot = await this.slots.upsert(
        {
          orgId,
          inviteId,
          sessionId,
          slotAt,
          timezone: body.timezone,
          interviewerIds: body.interviewerIds,
        },
        q,
      );
      return { slot };
    });
  }

  async getSchedule(inviteId: string, orgId?: string): Promise<{ slot: InterviewSlot | null }> {
    const slot = await this.slots.findByInviteId(inviteId);
    if (slot && orgId && slot.orgId !== orgId) {
      throw new ApiException(404, 'SLOT_NOT_FOUND', 'slot not found');
    }
    return { slot };
  }

  async requestReschedule(
    inviteId: string,
    body: RescheduleRequestBody,
  ): Promise<{ slot: InterviewSlot }> {
    return this.db.transaction(async (q) => {
      const slot = await this.slots.findByInviteId(inviteId, q);
      if (!slot) {
        throw new ApiException(404, 'SLOT_NOT_FOUND', 'no scheduled slot found');
      }
      const updated = await this.slots.markRescheduleRequested(
        slot.id,
        {
          reason: body.reason,
          requestedSlotAt: body.requestedSlotAt ? new Date(body.requestedSlotAt) : undefined,
        },
        q,
      );
      if (!updated) {
        throw new ApiException(404, 'SLOT_NOT_FOUND', 'slot not found');
      }
      return { slot: updated };
    });
  }

  async confirmReschedule(
    orgId: string,
    inviteId: string,
    newSlotAt: string,
  ): Promise<{ slot: InterviewSlot }> {
    const slotAt = new Date(newSlotAt);
    if (Number.isNaN(slotAt.getTime())) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'newSlotAt is not a valid date');
    }
    return this.db.transaction(async (q) => {
      const slot = await this.slots.findByInviteId(inviteId, q);
      if (!slot || slot.orgId !== orgId) {
        throw new ApiException(404, 'SLOT_NOT_FOUND', 'slot not found');
      }
      const updated = await this.slots.confirmReschedule(slot.id, slotAt, q);
      if (!updated) {
        throw new ApiException(404, 'SLOT_NOT_FOUND', 'slot not found');
      }
      return { slot: updated };
    });
  }

  generateIcs(slot: InterviewSlot, candidateEmail: string, candidateName: string): string {
    const start = new Date(slot.slotAt);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const format = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const uid = `${slot.id}@interviewos.local`;
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//InterviewOS//Human Facilitated Interview//EN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${format(start)}`,
      `DTEND:${format(end)}`,
      `SUMMARY:Interview with ${candidateName}`,
      `DESCRIPTION:Human-facilitated video interview.`,
      `ORGANIZER;CN=InterviewOS:mailto:no-reply@interviewos.local`,
      `ATTENDEE;CN=${candidateName};RSVP=TRUE:mailto:${candidateEmail}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  }

  /* ---- room tokens ---- */

  async issueCandidateToken(
    sessionId: string,
    rawRecoveryToken: string,
  ): Promise<LiveTokenResponse> {
    return this.db.transaction(async (q) => {
      const session = await this.loadAuthorizedSession(sessionId, rawRecoveryToken, q);
      if (session.conductor !== 'human') {
        throw new ApiException(409, 'SESSION_MODE_INVALID', 'session is not human-facilitated');
      }
      await this.ensureSlotWindow(session.inviteId, q);
      const updated = await this.advanceToLive(session, q);
      const roomName = `human-${sessionId}`;
      await this.sessions.setLivekitRoomName(sessionId, roomName, q);
      return {
        session: updated,
        livekit: issueLiveKitToken({
          apiKey: this.livekitApiKey(),
          apiSecret: this.livekitApiSecret(),
          url: this.livekitUrl(),
          roomName,
          identity: `candidate-${sessionId}`,
          name: 'Candidate',
        }),
      };
    });
  }

  async issueInterviewerToken(sessionId: string, user: AppUser): Promise<LiveTokenResponse> {
    return this.db.transaction(async (q) => {
      const session = await this.sessions.findById(sessionId, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      if (session.conductor !== 'human') {
        throw new ApiException(409, 'SESSION_MODE_INVALID', 'session is not human-facilitated');
      }
      const orgCheck = await q.query('SELECT org_id FROM invite WHERE id = $1', [session.inviteId]);
      const inviteOrgId = (orgCheck.rows[0] as { org_id: string } | undefined)?.org_id;
      if (inviteOrgId !== user.orgId) {
        throw new ApiException(403, 'FORBIDDEN', 'session does not belong to your organization');
      }
      await this.ensureSlotWindow(session.inviteId, q);
      const updated = await this.advanceToLive(session, q);
      const roomName = session.livekitRoomName ?? `human-${sessionId}`;
      return {
        session: updated,
        livekit: issueLiveKitToken({
          apiKey: this.livekitApiKey(),
          apiSecret: this.livekitApiSecret(),
          url: this.livekitUrl(),
          roomName,
          identity: `interviewer-${user.id}`,
          name: user.name,
        }),
      };
    });
  }

  /* ---- cockpit state ---- */

  async getCockpitState(sessionId: string, user: AppUser): Promise<CockpitStateResponse> {
    return this.db.transaction(async (q) => {
      const session = await this.sessions.findById(sessionId, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      const orgCheck = await q.query('SELECT org_id FROM invite WHERE id = $1', [session.inviteId]);
      const inviteOrgId = (orgCheck.rows[0] as { org_id: string } | undefined)?.org_id;
      if (inviteOrgId !== user.orgId) {
        throw new ApiException(403, 'FORBIDDEN', 'session does not belong to your organization');
      }
      const [inviteRow, kitVersion, transcript, slot] = await Promise.all([
        q.query('SELECT candidate_id FROM invite WHERE id = $1', [session.inviteId]),
        this.kitVersions.findById(session.kitVersionId, q),
        this.transcript.listBySession(sessionId, q),
        this.slots.findByInviteId(session.inviteId, q),
      ]);
      const candidateId = (inviteRow.rows[0] as { candidate_id: string } | undefined)?.candidate_id;
      if (!candidateId) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      const candidate = await this.candidates.findById(user.orgId, candidateId, q);
      if (!candidate) {
        throw new ApiException(404, 'CANDIDATE_NOT_FOUND', 'candidate not found');
      }
      if (!kitVersion) {
        throw new ApiException(404, 'KIT_VERSION_NOT_FOUND', 'kit version not found');
      }
      const kit: KitSnapshot = kitVersion.snapshot;
      await this.coverage.ensureQuestions(
        sessionId,
        kit.questions.map((q) => q.id),
        q,
      );
      const coverage = await this.coverage.listBySession(sessionId, q);
      const notes = await this.notes.findBySessionId(sessionId, q);
      const report = await this.evaluation.findReportBySessionId(sessionId);
      const scorecardPrefill = report ? await this.evaluation.listScores(report.id) : null;
      return {
        session,
        candidate,
        kit,
        slot,
        coverage,
        transcript,
        notes,
        scorecardPrefill,
      };
    });
  }

  async markCoverage(
    sessionId: string,
    user: AppUser,
    body: MarkCoverageBody,
  ): Promise<{ coverage: SessionCoverage[] }> {
    return this.db.transaction(async (q) => {
      const session = await this.sessions.findById(sessionId, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      const orgCheck = await q.query('SELECT org_id FROM invite WHERE id = $1', [session.inviteId]);
      const inviteOrgId = (orgCheck.rows[0] as { org_id: string } | undefined)?.org_id;
      if (inviteOrgId !== user.orgId) {
        throw new ApiException(403, 'FORBIDDEN', 'session does not belong to your organization');
      }
      await this.coverage.mark(sessionId, body.questionId, body.action, user.id, q);
      const coverage = await this.coverage.listBySession(sessionId, q);
      return { coverage };
    });
  }

  /* ---- end call ---- */

  async endCall(sessionId: string, _user: AppUser): Promise<LiveEndResponse> {
    return this.db.transaction(async (q) => {
      const session = await this.sessions.findById(sessionId, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      if (session.status !== 'live') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }
      const updated = await this.sessions.updateStatus(sessionId, 'completed', q, {
        endedAt: new Date(),
      });
      if (!updated) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      await q.query("UPDATE invite SET status = 'completed', updated_at = now() WHERE id = $1", [
        session.inviteId,
      ]);
      const report = await this.evaluation.evaluateSession(sessionId);
      const notes = await this.notes.generateForSession(sessionId, q);
      await this.evaluation.attachNotes(report.id, notes.id, q);
      return { session: updated, reportId: report.id };
    });
  }

  /* ---- helpers ---- */

  private async loadAuthorizedSession(sessionId: string, rawRecoveryToken: string, q: Queryable) {
    const session = await this.sessions.findById(sessionId, q);
    if (!session) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
    }
    if (
      !session.recoveryTokenHash ||
      session.recoveryTokenHash !== TokenService.hash(rawRecoveryToken)
    ) {
      throw new ApiException(401, 'RECOVERY_TOKEN_INVALID', 'recovery token is invalid');
    }
    return session;
  }

  private async ensureSlotWindow(inviteId: string, q: Queryable): Promise<void> {
    const slot = await this.slots.findByInviteId(inviteId, q);
    if (!slot) {
      throw new ApiException(409, 'SLOT_REQUIRED', 'interview has not been scheduled');
    }
    const slotAt = new Date(slot.slotAt).getTime();
    const now = Date.now();
    if (now < slotAt - WINDOW_MINUTES * 60 * 1000 || now > slotAt + WINDOW_MINUTES * 60 * 1000) {
      throw new ApiException(
        409,
        'SLOT_WINDOW_CLOSED',
        `room link is only active within ±${WINDOW_MINUTES} minutes of the scheduled slot`,
      );
    }
  }

  private async advanceToLive(
    session: import('@zios/shared-types').InterviewSession,
    q: Queryable,
  ) {
    let current = session;
    if (current.status === 'consented') {
      current = (await this.sessions.updateStatus(current.id, 'preflight', q, {})) ?? current;
    }
    if (current.status === 'preflight') {
      current =
        (await this.sessions.updateStatus(current.id, 'live', q, { startedAt: new Date() })) ??
        current;
    }
    if (current.status !== 'live') {
      throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${current.status}`);
    }
    return current;
  }

  private livekitUrl(): string {
    return process.env.LIVEKIT_URL ?? 'ws://localhost:7880';
  }

  private livekitApiKey(): string {
    return process.env.LIVEKIT_API_KEY ?? 'devkey';
  }

  private livekitApiSecret(): string {
    return process.env.LIVEKIT_API_SECRET ?? 'secret';
  }
}

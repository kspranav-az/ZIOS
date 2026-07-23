import { Inject, Injectable } from '@nestjs/common';
import type {
  ConsentByTokenBody,
  ConsentByTokenResponse,
  ConsentRecord,
  InterviewSession,
  KitSnapshot,
  PreflightBody,
  PreflightResponse,
  SessionDetailResponse,
  SessionTurnResponse,
  TurnBody,
  TurnResponse,
} from '@zios/shared-types';
import { TokenService } from '@/common/tokens';
import { CandidatesRepository } from '@/modules/candidates';
import { ConsentService } from '@/modules/consent';
import { EvaluationService } from '@/modules/evaluation';
import { ApiException } from '@/common/errors';
import { DatabaseService, type Queryable } from '@/modules/database';
import { KitVersionsRepository } from '@/modules/kits';
import { eventForTransition, transition } from './state-machine';
import { EventsRepository } from './events.repository';
import { INTERVIEWER_AI, type InterviewerAi } from './interviewer-ai.port';
import { SessionsRepository } from './sessions.repository';
import { TranscriptRepository } from './transcript.repository';

const TIMER_GRACE_SECONDS = 15;

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionsRepository,
    private readonly transcript: TranscriptRepository,
    private readonly events: EventsRepository,
    private readonly consent: ConsentService,
    private readonly candidates: CandidatesRepository,
    private readonly evaluation: EvaluationService,
    private readonly kitVersions: KitVersionsRepository,
    @Inject(INTERVIEWER_AI) private readonly conductor: InterviewerAi,
  ) {}

  /* ---- public helpers ---- */

  private async loadSessionByRecoveryToken(
    sessionId: string,
    rawRecoveryToken: string,
    q: Queryable,
  ): Promise<InterviewSession> {
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

  private async loadSnapshot(kitVersionId: string, q: Queryable): Promise<KitSnapshot> {
    const version = await this.kitVersions.findById(kitVersionId, q);
    if (!version) {
      throw new ApiException(404, 'KIT_VERSION_NOT_FOUND', 'kit version not found');
    }
    return version.snapshot;
  }

  private async emit(
    q: Queryable,
    sessionId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await this.events.insert({ sessionId, type, payload }, q);
  }

  private async advanceSessionStatus(
    q: Queryable,
    session: InterviewSession,
    to: InterviewSession['status'],
    extras?: Parameters<SessionsRepository['updateStatus']>[3],
  ): Promise<InterviewSession> {
    transition(session.status, to);
    const updated = await this.sessions.updateStatus(session.id, to, q, extras);
    if (!updated) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
    }
    await this.emit(q, session.id, eventForTransition(to), { from: session.status, to });
    return updated;
  }

  private async buildNextTurn(
    q: Queryable,
    session: InterviewSession,
    snapshot: KitSnapshot,
  ): Promise<{ session: InterviewSession; turn: SessionTurnResponse }> {
    const transcript = await this.transcript.listBySession(session.id, q);
    const turn = await this.conductor.nextTurn({ session, snapshot, transcript });

    if (turn.type === 'wrapup') {
      const completed = await this.advanceSessionStatus(q, session, 'completed', {
        endedAt: new Date(),
      });
      // Tombstone the invite so the link cannot be reused post-completion.
      await q.query("UPDATE invite SET status = 'completed', updated_at = now() WHERE id = $1", [
        session.inviteId,
      ]);
      return { session: completed, turn };
    }

    // Ask the next question/followup by appending a transcript row.
    const position = transcript.length;
    await this.transcript.insert(
      {
        sessionId: session.id,
        questionId: turn.questionId as string,
        questionPrompt: turn.text,
        position,
      },
      q,
    );
    return { session, turn };
  }

  /* ---- consent / session creation ---- */

  async recordConsentByToken(
    rawToken: string,
    body: ConsentByTokenBody,
  ): Promise<ConsentByTokenResponse> {
    const tokenHash = TokenService.hash(rawToken);
    return this.db.transaction(async (q) => {
      const inviteRow = await q.query(
        `SELECT id, org_id, kit_version_id, candidate_id, otp_required, otp_verified_at, status, conductor, expires_at
         FROM invite WHERE token_hash = $1`,
        [tokenHash],
      );
      const invite = inviteRow.rows[0] as
        | {
            id: string;
            org_id: string;
            kit_version_id: string;
            candidate_id: string;
            otp_required: boolean;
            otp_verified_at: Date | null;
            status: string;
            conductor: string;
            expires_at: Date;
          }
        | undefined;
      if (!invite) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      if (invite.status === 'completed') {
        throw new ApiException(
          409,
          'INVITE_COMPLETED',
          'this interview has already been completed',
        );
      }
      if (new Date() > invite.expires_at) {
        throw new ApiException(410, 'INVITE_EXPIRED', 'this invite link has expired');
      }
      if (invite.otp_required && !invite.otp_verified_at) {
        throw new ApiException(403, 'OTP_REQUIRED', 'OTP verification is required before consent');
      }

      // Update candidate identity if the candidate edits it on the form.
      const candidate = await this.candidates.findById(invite.org_id, invite.candidate_id, q);
      if (candidate) {
        const name = body?.name?.trim();
        const email = body?.email?.trim().toLowerCase();
        const phone = body?.phone?.trim();
        await this.candidates.update(
          invite.org_id,
          invite.candidate_id,
          {
            name: name || candidate.name,
            email: email || candidate.email,
            phone: phone ?? candidate.phone,
          },
          q,
        );
      }

      // Consent must be recorded before any capture (FR-E6-2 / X8).
      const subjectId = candidate ? candidate.email : invite.candidate_id;
      const consent: ConsentRecord = await this.consent.createForInvite(
        { inviteId: invite.id, subjectId, noticeText: body?.noticeText },
        q,
      );

      // Resume an existing non-completed session if present (including abandoned -> invited).
      const existing = await this.sessions.findByInviteId(invite.id, q);
      if (existing && existing.status !== 'completed') {
        await this.sessions.setConsentId(existing.id, consent.id, q);
        if (existing.status === 'abandoned') {
          await this.advanceSessionStatus(q, existing, 'consented');
        }
        const rawRecovery = TokenService.generateRaw();
        await q.query(
          'UPDATE interview_session SET recovery_token_hash = $1, updated_at = now() WHERE id = $2',
          [TokenService.hash(rawRecovery), existing.id],
        );
        const refreshed = (await this.sessions.findById(existing.id, q)) as InterviewSession;
        return { consent, session: refreshed, recoveryToken: rawRecovery };
      }

      const snapshot = await this.loadSnapshot(invite.kit_version_id, q);
      const rawRecovery = TokenService.generateRaw();
      const session = await this.sessions.insert(
        {
          inviteId: invite.id,
          kitVersionId: invite.kit_version_id,
          mode: snapshot.kit.settings.mode,
          conductor: invite.conductor as InterviewSession['conductor'],
          status: 'consented',
          consentId: consent.id,
          recoveryTokenHash: TokenService.hash(rawRecovery),
        },
        q,
      );
      await this.emit(q, session.id, 'session.created', { from: 'invite', to: 'consented' });
      await q.query("UPDATE invite SET status = 'started', updated_at = now() WHERE id = $1", [
        invite.id,
      ]);
      return { consent, session, recoveryToken: rawRecovery };
    });
  }

  /* ---- preflight ---- */

  async preflight(
    sessionId: string,
    rawRecoveryToken: string,
    body?: PreflightBody,
  ): Promise<PreflightResponse> {
    const result = await this.db.transaction(async (q) => {
      let session = await this.loadSessionByRecoveryToken(sessionId, rawRecoveryToken, q);
      const snapshot = await this.loadSnapshot(session.kitVersionId, q);

      // Idempotent: the interviewer may have already advanced a human-facilitated
      // session to 'live' before the candidate clicks Start. In that case just
      // let the candidate through without re-advancing or generating a turn.
      if (session.status === 'live') {
        if (session.conductor === 'human') {
          const turn: SessionTurnResponse = { type: 'question', text: '', questionId: null };
          return { session, turn };
        }
        return this.buildNextTurn(q, session, snapshot);
      }

      if (session.status !== 'consented' && session.status !== 'preflight') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }

      if (session.status === 'consented') {
        session = await this.advanceSessionStatus(q, session, 'preflight', {
          preflightReport: body?.report ?? {},
        });
      }
      session = await this.advanceSessionStatus(q, session, 'live', {
        startedAt: new Date(),
      });

      // If the candidate is returning to a previously-live session (abandon/recovery),
      // re-present the last unanswered question/followup instead of asking a new one.
      const transcript = await this.transcript.listBySession(session.id, q);
      const lastRow = transcript[transcript.length - 1] ?? null;
      if (lastRow && lastRow.answerText === null) {
        const askedForQuestion = transcript.filter(
          (t) => t.questionId === lastRow.questionId,
        ).length;
        const turn: SessionTurnResponse = {
          type: askedForQuestion > 1 ? 'followup' : 'question',
          text: lastRow.questionPrompt,
          questionId: lastRow.questionId,
        };
        return { session, turn };
      }

      return this.buildNextTurn(q, session, snapshot);
    });

    if (result.session.status === 'completed') {
      await this.evaluation.evaluateSession(result.session.id);
    }
    return result;
  }

  /* ---- turn ---- */

  async turn(sessionId: string, rawRecoveryToken: string, body?: TurnBody): Promise<TurnResponse> {
    const result = await this.db.transaction(async (q) => {
      const session = await this.loadSessionByRecoveryToken(sessionId, rawRecoveryToken, q);
      if (session.status !== 'live') {
        // Allow completing an already-wrapped session to return the wrapup again.
        if (session.status === 'completed') {
          const snapshot = await this.loadSnapshot(session.kitVersionId, q);
          const transcript = await this.transcript.listBySession(session.id, q);
          const turn = await this.conductor.nextTurn({ session, snapshot, transcript });
          return { session, turn };
        }
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }
      const snapshot = await this.loadSnapshot(session.kitVersionId, q);
      const transcript = await this.transcript.listBySession(session.id, q);
      const lastRow = transcript[transcript.length - 1] ?? null;

      if (lastRow && lastRow.answerText === null) {
        if (body?.answer === undefined) {
          // No answer yet: re-present the current question/followup.
          const askedForQuestion = transcript.filter(
            (t) => t.questionId === lastRow.questionId,
          ).length;
          const turn: SessionTurnResponse = {
            type: askedForQuestion > 1 ? 'followup' : 'question',
            text: lastRow.questionPrompt,
            questionId: lastRow.questionId,
          };
          return { session, turn };
        }
        const question = snapshot.questions.find((q) => q.id === lastRow.questionId);
        if (question) {
          const elapsedSec = (Date.now() - new Date(lastRow.createdAt).getTime()) / 1000;
          const limit = question.timeLimitSec ?? 120;
          if (question.timeLimitType === 'hard' && elapsedSec > limit + TIMER_GRACE_SECONDS) {
            throw new ApiException(
              409,
              'TIME_LIMIT_EXCEEDED',
              'answer arrived after the hard time limit plus grace period',
            );
          }
        }
        await this.transcript.answer(lastRow.id, body.answer, q);
        await this.emit(q, session.id, 'session.turn_answered', {
          questionId: lastRow.questionId,
        });
      }

      return this.buildNextTurn(q, session, snapshot);
    });

    if (result.session.status === 'completed') {
      await this.evaluation.evaluateSession(result.session.id);
    }
    return result;
  }

  /* ---- abandon / recovery ---- */

  async abandon(sessionId: string, rawRecoveryToken: string): Promise<InterviewSession> {
    return this.db.transaction(async (q) => {
      const session = await this.loadSessionByRecoveryToken(sessionId, rawRecoveryToken, q);
      if (session.status !== 'live') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }
      return this.advanceSessionStatus(q, session, 'abandoned');
    });
  }

  async recover(sessionId: string, rawRecoveryToken: string): Promise<ConsentByTokenResponse> {
    return this.db.transaction(async (q) => {
      const session = await this.loadSessionByRecoveryToken(sessionId, rawRecoveryToken, q);
      if (session.status !== 'abandoned') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }
      await this.advanceSessionStatus(q, session, 'invited');
      const rawRecovery = TokenService.generateRaw();
      await q.query(
        'UPDATE interview_session SET recovery_token_hash = $1, updated_at = now() WHERE id = $2',
        [TokenService.hash(rawRecovery), session.id],
      );
      const consent = await this.consent.findBySessionId(session.id, q);
      const refreshed = (await this.sessions.findById(session.id, q)) as InterviewSession;
      return { consent: consent as ConsentRecord, session: refreshed, recoveryToken: rawRecovery };
    });
  }

  /* ---- auth lookups ---- */

  async findByInviteId(inviteId: string): Promise<InterviewSession | null> {
    return this.sessions.findByInviteId(inviteId);
  }

  async getDetail(sessionId: string): Promise<SessionDetailResponse> {
    return this.db.transaction(async (q) => {
      const session = await this.sessions.findById(sessionId, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      const transcript = await this.transcript.listBySession(sessionId, q);
      const events = await this.events.listBySession(sessionId, q);
      return { session, transcript, events };
    });
  }
}

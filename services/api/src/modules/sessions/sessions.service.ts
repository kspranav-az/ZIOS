import { Inject, Injectable } from '@nestjs/common';
import type {
  AnswerData,
  ConsentByTokenBody,
  ConsentByTokenResponse,
  ConsentRecord,
  InterviewSession,
  KitQuestion,
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
import {
  WebhookFanoutService,
  WebhooksQueue,
  type WebhookDelivery,
} from '@/modules/webhooks';
import { eventForTransition, transition } from './state-machine';
import { EventsRepository } from './events.repository';
import { INTERVIEWER_AI, type InterviewerAi } from './interviewer-ai.port';
import { SessionsRepository } from './sessions.repository';
import { TranscriptRepository } from './transcript.repository';

const TIMER_GRACE_SECONDS = 15;

function formatAnswerText(question: KitQuestion, answerData: AnswerData): string {
  if (answerData.type === 'rating_scale' && answerData.rating !== undefined) {
    return `Rating: ${answerData.rating}/5`;
  }
  if (
    (answerData.type === 'mcq_single' || answerData.type === 'mcq_multi') &&
    answerData.selectedOptionIds !== undefined
  ) {
    const selected = (question.options ?? []).filter((o) =>
      answerData.selectedOptionIds?.includes(o.id),
    );
    const labels = selected.map((o) => o.text);
    return labels.length > 0 ? labels.join(', ') : '(no selection)';
  }
  return '';
}

function validateAnswerData(question: KitQuestion, answerData: AnswerData): void {
  if (answerData.type !== question.type) {
    throw new ApiException(400, 'ANSWER_TYPE_MISMATCH', 'answer type does not match question type');
  }
  if (question.type === 'rating_scale') {
    if (
      answerData.rating === undefined ||
      !Number.isInteger(answerData.rating) ||
      answerData.rating < 1 ||
      answerData.rating > 5
    ) {
      throw new ApiException(400, 'INVALID_RATING', 'rating must be an integer between 1 and 5');
    }
    return;
  }
  if (question.type === 'mcq_single' || question.type === 'mcq_multi') {
    const selected = answerData.selectedOptionIds ?? [];
    if (!Array.isArray(selected) || selected.length === 0) {
      throw new ApiException(400, 'INVALID_MCQ_SELECTION', 'at least one option must be selected');
    }
    const validIds = new Set((question.options ?? []).map((o) => o.id));
    if (selected.some((id) => !validIds.has(id))) {
      throw new ApiException(
        400,
        'INVALID_MCQ_OPTION',
        'selected option does not belong to the question',
      );
    }
    if (question.type === 'mcq_single' && selected.length > 1) {
      throw new ApiException(400, 'INVALID_MCQ_SINGLE', 'only one option may be selected');
    }
    return;
  }
  throw new ApiException(
    400,
    'INVALID_ANSWER_DATA',
    'answer data not valid for this question type',
  );
}

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
    private readonly webhookFanout: WebhookFanoutService,
    private readonly webhookQueue: WebhooksQueue,
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

  /** BullMQ enqueue strictly after the interview transaction has committed. */
  private async enqueueWebhookDeliveries(deliveries: WebhookDelivery[] | undefined): Promise<void> {
    for (const delivery of deliveries ?? []) {
      await this.webhookQueue.add(delivery.id);
    }
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
  ): Promise<{ session: InterviewSession; turn: SessionTurnResponse; webhookDeliveries: WebhookDelivery[] }> {
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
      // Durable webhook rows in-transaction (FR-E13-4); BullMQ jobs are
      // enqueued by the caller only after commit.
      const completedEvent = await this.events.findLatestBySession(session.id, q);
      const webhookDeliveries = completedEvent
        ? await this.webhookFanout.fanout(q, {
            sessionEventId: completedEvent.id,
            sessionId: session.id,
            inviteId: session.inviteId,
            event: 'interview.completed',
            occurredAt: new Date(completedEvent.occurredAt),
          })
        : [];
      return { session: completed, turn, webhookDeliveries };
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
    return { session, turn, webhookDeliveries: [] };
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
          return { session, turn, webhookDeliveries: [] };
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
        return { session, turn, webhookDeliveries: [] };
      }

      return this.buildNextTurn(q, session, snapshot);
    });

    if (result.session.status === 'completed') {
      await this.enqueueWebhookDeliveries(result.webhookDeliveries);
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
          return { session, turn, webhookDeliveries: [] };
        }
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }
      const snapshot = await this.loadSnapshot(session.kitVersionId, q);
      const transcript = await this.transcript.listBySession(session.id, q);
      const lastRow = transcript[transcript.length - 1] ?? null;

      if (lastRow && lastRow.answerText === null) {
        const hasTextAnswer = body?.answer !== undefined && body.answer.length > 0;
        const hasStructuredAnswer = body?.answerData !== undefined;
        if (!hasTextAnswer && !hasStructuredAnswer) {
          // No answer yet: re-present the current question/followup.
          const askedForQuestion = transcript.filter(
            (t) => t.questionId === lastRow.questionId,
          ).length;
          const turn: SessionTurnResponse = {
            type: askedForQuestion > 1 ? 'followup' : 'question',
            text: lastRow.questionPrompt,
            questionId: lastRow.questionId,
          };
          return { session, turn, webhookDeliveries: [] };
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
        const answerData = hasStructuredAnswer ? body.answerData : undefined;
        let answerText = body?.answer ?? '';
        if (answerData && question) {
          validateAnswerData(question, answerData);
          answerText = formatAnswerText(question, answerData);
        }
        await this.transcript.answer(lastRow.id, answerText, q, undefined, answerData);
        await this.emit(q, session.id, 'session.turn_answered', {
          questionId: lastRow.questionId,
        });
      }

      return this.buildNextTurn(q, session, snapshot);
    });

    if (result.session.status === 'completed') {
      await this.enqueueWebhookDeliveries(result.webhookDeliveries);
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

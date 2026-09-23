import { Inject, Injectable } from '@nestjs/common';
import type {
  InterviewSession,
  KitSnapshot,
  PracticeConsentBody,
  PracticeCreateBody,
  PracticeMode,
  SessionTurnResponse,
} from '@zios/shared-types';
import { TokenService } from '@/common/tokens';
import { ApiException } from '@/common/errors';
import { DatabaseService, type Queryable } from '@/modules/database';
import { CreditsService, assertCanStart, priceForKind } from '@/modules/credits';
import { INTERVIEWER_AI, type InterviewerAi } from '@/modules/sessions';
import { transition } from '@/modules/sessions';
import { PRACTICE_CONSENT_TEXT_VERSION } from './consent-text';
import { findPack } from './library';
import { PracticeEvaluationService } from './practice-evaluation.service';
import { PracticeSessionRepository, type PracticeSessionRecord } from './practice-session.repository';
import { PracticeTranscriptRepository } from './practice-transcript.repository';

/** D11 COGS guardrail (beta): max completed mocks per account per day. */
export const PRACTICE_DAILY_COMPLETION_CAP = 3;

/**
 * Practice session lifecycle (Phase 12, D5): create → consent → preflight →
 * turn loop → wrapup. Mirrors SessionsService but sources questions from the
 * inline snapshot and never touches employer tables. The conductor port
 * (INTERVIEWER_AI) is reused as-is via an InterviewSession-shaped adapter —
 * the LLM adapter only reads snapshot + transcript, so practice questions
 * flow through the exact same engine.
 */
@Injectable()
export class PracticeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: PracticeSessionRepository,
    private readonly transcript: PracticeTranscriptRepository,
    private readonly credits: CreditsService,
    private readonly evaluation: PracticeEvaluationService,
    @Inject(INTERVIEWER_AI) private readonly conductor: InterviewerAi,
  ) {}

  async create(
    accountId: string,
    body: PracticeCreateBody,
    requestMeta: { ip?: string; userAgent?: string },
  ): Promise<{ session: PracticeSessionRecord; recoveryToken: string }> {
    const pack = findPack(body.packId);
    if (!pack) {
      throw new ApiException(404, 'PACK_NOT_FOUND', 'question pack not found');
    }
    if (body.mode !== 'text' && body.mode !== 'voice') {
      throw new ApiException(400, 'VALIDATION_ERROR', 'mode must be text or voice');
    }
    return this.db.transaction(async (q) => {
      // D11: refuse to start a new mock once today's completion cap is hit.
      const completedToday = await this.sessions.countCompletedToday(accountId, q);
      if (completedToday >= PRACTICE_DAILY_COMPLETION_CAP) {
        throw new ApiException(
          429,
          'DAILY_CAP_REACHED',
          `the beta allows ${PRACTICE_DAILY_COMPLETION_CAP} completed mocks per day — come back tomorrow`,
        );
      }
      const creditAccountId = await this.credits.ensureAccount('candidate', accountId, q);
      const rawRecovery = TokenService.generateRaw();
      const session = await this.sessions.insert(
        {
          accountId,
          mode: body.mode,
          source: 'library',
          title: pack.title,
          snapshot: { questions: pack.questions },
          creditAccountId,
          recoveryTokenHash: TokenService.hash(rawRecovery),
        },
        q,
      );
      void requestMeta; // ip/ua captured at consent time
      return { session, recoveryToken: rawRecovery };
    });
  }

  /** X8: consent must exist before any capture — stored artifact, 100%. */
  async consent(
    accountId: string,
    sessionId: string,
    body: PracticeConsentBody,
    requestMeta: { ip?: string; userAgent?: string },
  ): Promise<{ session: PracticeSessionRecord }> {
    return this.db.transaction(async (q) => {
      const session = await this.loadOwnedSession(sessionId, accountId, q);
      if (session.status !== 'created' && session.status !== 'abandoned') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }
      if (typeof body?.recordingAllowed !== 'boolean') {
        throw new ApiException(400, 'VALIDATION_ERROR', 'recordingAllowed is required');
      }
      const consent = await q.query(
        `INSERT INTO practice_consent
           (session_id, account_id, recording_allowed, model_opt_in, text_version, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          sessionId,
          accountId,
          body.recordingAllowed,
          body.modelOptIn === true,
          PRACTICE_CONSENT_TEXT_VERSION,
          requestMeta.ip ?? null,
          requestMeta.userAgent ?? null,
        ],
      );
      const consentId = (consent.rows[0] as { id: string }).id;
      const status = session.status === 'abandoned' ? 'consented' : 'consented';
      const updated = await this.sessions.updateStatus(sessionId, status, q, { consentId });
      return { session: updated as PracticeSessionRecord };
    });
  }

  async preflight(
    accountId: string,
    sessionId: string,
    rawRecoveryToken: string,
  ): Promise<{ session: PracticeSessionRecord; turn: SessionTurnResponse }> {
    const result = await this.db.transaction(async (q) => {
      let session = await this.loadByRecoveryToken(sessionId, rawRecoveryToken, q);
      this.assertOwned(session, accountId);

      if (session.status === 'live') {
        return this.buildNextTurn(q, session);
      }
      // X8 gate runs before the state check so a never-consented session
      // reports the actionable error: no consent artifact → no live
      // transition (409, never silent).
      const consentRow = await q.query(
        `SELECT id FROM practice_consent WHERE session_id = $1 LIMIT 1`,
        [sessionId],
      );
      if ((consentRow.rowCount ?? 0) === 0) {
        throw new ApiException(409, 'CONSENT_REQUIRED', 'consent must be recorded before starting');
      }
      if (session.status !== 'consented' && session.status !== 'preflight') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }

      if (session.status === 'consented') {
        session = await this.advance(q, session, 'preflight');
      }

      // Live transition = charge point (same transaction as the debit).
      const price = priceForKind(session.mode as PracticeMode);
      await assertCanStart((id) => this.credits.getBalance(id, q), session.creditAccountId, price);
      await this.credits.debit(
        session.creditAccountId,
        price,
        'practice_start',
        q,
        { metadata: { mode: session.mode, source: session.source } },
      );
      session = await this.advance(q, session, 'live', { startedAt: new Date() });
      return this.buildNextTurn(q, session);
    });
    if (result.session.status === 'completed') {
      await this.evaluation.evaluateSession(result.session.id);
    }
    return result;
  }

  async turn(
    accountId: string,
    sessionId: string,
    rawRecoveryToken: string,
    body?: { answer?: string },
  ): Promise<{ session: PracticeSessionRecord; turn: SessionTurnResponse }> {
    const result = await this.db.transaction(async (q) => {
      let session = await this.loadByRecoveryToken(sessionId, rawRecoveryToken, q);
      this.assertOwned(session, accountId);
      if (session.status === 'completed') {
        return this.buildNextTurn(q, session);
      }
      if (session.status !== 'live') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }
      const rows = await this.transcript.listBySession(session.id, q);
      const lastRow = rows[rows.length - 1] ?? null;
      if (lastRow && lastRow.answerText === null) {
        const answer = body?.answer?.trim();
        if (!answer) {
          // Re-present the unanswered question/followup.
          const askedForQuestion = rows.filter((t) => t.questionId === lastRow.questionId).length;
          const turn: SessionTurnResponse = {
            type: askedForQuestion > 1 ? 'followup' : 'question',
            text: lastRow.questionPrompt,
            questionId: lastRow.questionId,
          };
          return { session, turn };
        }
        await this.transcript.answer(lastRow.id, answer, q);
      }
      session = (await this.sessions.findById(session.id, q)) as PracticeSessionRecord;
      return this.buildNextTurn(q, session);
    });
    if (result.session.status === 'completed') {
      // Scoring runs outside the interview transaction: a judge failure must
      // not roll back the completed session (same contract as interviews).
      await this.evaluation.evaluateSession(result.session.id);
    }
    return result;
  }

  async abandon(accountId: string, sessionId: string, rawRecoveryToken: string) {
    return this.db.transaction(async (q) => {
      const session = await this.loadByRecoveryToken(sessionId, rawRecoveryToken, q);
      this.assertOwned(session, accountId);
      if (session.status !== 'live') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }
      return this.advance(q, session, 'abandoned');
    });
  }

  async recover(
    accountId: string,
    sessionId: string,
    rawRecoveryToken: string,
  ): Promise<{ session: PracticeSessionRecord; recoveryToken: string }> {
    return this.db.transaction(async (q) => {
      const session = await this.loadByRecoveryToken(sessionId, rawRecoveryToken, q);
      this.assertOwned(session, accountId);
      if (session.status !== 'abandoned') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }
      await this.advance(q, session, 'consented');
      const rawRecovery = TokenService.generateRaw();
      await this.sessions.setRecoveryToken(sessionId, TokenService.hash(rawRecovery), q);
      const refreshed = (await this.sessions.findById(sessionId, q)) as PracticeSessionRecord;
      return { session: refreshed, recoveryToken: rawRecovery };
    });
  }

  async detail(accountId: string, sessionId: string) {
    const session = await this.sessions.findById(sessionId);
    if (!session || session.accountId !== accountId) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'practice session not found');
    }
    const transcript = await this.transcript.listBySession(sessionId);
    return { session, transcript, questions: session.snapshot.questions };
  }

  /* ---- internals ---- */

  private assertOwned(session: PracticeSessionRecord, accountId: string): void {
    if (session.accountId !== accountId) {
      // Same 404 as a missing session: no existence leak across accounts.
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'practice session not found');
    }
  }

  private async loadOwnedSession(
    sessionId: string,
    accountId: string,
    q: Queryable,
  ): Promise<PracticeSessionRecord> {
    const session = await this.sessions.findById(sessionId, q);
    if (!session) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'practice session not found');
    }
    this.assertOwned(session, accountId);
    return session;
  }

  private async loadByRecoveryToken(
    sessionId: string,
    rawRecoveryToken: string,
    q: Queryable,
  ): Promise<PracticeSessionRecord> {
    const session = await this.sessions.findById(sessionId, q);
    if (!session) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'practice session not found');
    }
    if (
      !session.recoveryTokenHash ||
      session.recoveryTokenHash !== TokenService.hash(rawRecoveryToken)
    ) {
      throw new ApiException(401, 'RECOVERY_TOKEN_INVALID', 'recovery token is invalid');
    }
    return session;
  }

  private async advance(
    q: Queryable,
    session: PracticeSessionRecord,
    to: string,
    extras?: { startedAt?: Date },
  ): Promise<PracticeSessionRecord> {
    transition(session.status as InterviewSession['status'], to as InterviewSession['status']);
    const updated = await this.sessions.updateStatus(session.id, to, q, extras);
    if (!updated) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'practice session not found');
    }
    return updated;
  }

  /**
   * Practice adapter: present the session as an InterviewSession + KitSnapshot
   * to the reused conductor port. Only fields the conductor reads (snapshot,
   * transcript) carry real data; the rest are inert placeholders — practice
   * never writes employer tables.
   */
  private toConductorContext(session: PracticeSessionRecord) {
    const snapshot: KitSnapshot = {
      schemaVersion: 1,
      kit: {
        id: `practice-${session.id}`,
        title: session.title,
        role: null,
        level: null,
        settings: {
        mode: session.mode,
        language: 'en',
        proctoringLevel: 'none',
        introText: null,
        outroText: null,
        logoUrl: null,
        totalTimeCapSec: 3600,
      },
        jdRef: null,
      },
      questions: session.snapshot.questions,
      durationEstimateSec: 0,
    };
    const adapted: InterviewSession = {
      id: session.id,
      inviteId: '',
      kitVersionId: `practice-${session.id}`,
      mode: session.mode,
      conductor: 'ai',
      status: session.status as InterviewSession['status'],
      consentId: session.consentId,
      preflightReport: {},
      startedAt: session.startedAt,
      endedAt: session.completedAt,
      mediaRefs: [],
      integrityEvents: [],
      schemaVersion: 1,
      recoveryTokenHash: session.recoveryTokenHash,
      livekitRoomName: null,
      fallbackToTextAt: null,
      createdAt: session.createdAt,
      updatedAt: session.createdAt,
    };
    return { snapshot, adapted };
  }

  private async buildNextTurn(
    q: Queryable,
    session: PracticeSessionRecord,
  ): Promise<{ session: PracticeSessionRecord; turn: SessionTurnResponse }> {
    const rows = await this.transcript.listBySession(session.id, q);
    const { snapshot, adapted } = this.toConductorContext(session);
    const turn = await this.conductor.nextTurn({ session: adapted, snapshot, transcript: rows });

    if (turn.type === 'wrapup') {
      const completed = await this.advance(q, session, 'completed', { startedAt: undefined });
      return { session: completed, turn };
    }
    await this.transcript.insert(
      {
        sessionId: session.id,
        questionId: turn.questionId as string,
        questionPrompt: turn.text,
        position: rows.length,
      },
      q,
    );
    return { session, turn };
  }
}

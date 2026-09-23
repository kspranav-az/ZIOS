import { Inject, Injectable } from '@nestjs/common';
import type {
  InterviewSession,
  KitQuestion,
  KitSnapshot,
  PracticeConsentBody,
  PracticeCreateBody,
  PracticeLiveTokenResponse,
  PracticeMode,
  ProposedQuestion,
  SessionTurnResponse,
} from '@zios/shared-types';
import { TokenService } from '@/common/tokens';
import { ApiException } from '@/common/errors';
import { DatabaseService, type Queryable } from '@/modules/database';
import {
  CreditsService,
  CreditsAlertService,
  assertCanStart,
  priceForKind,
} from '@/modules/credits';
import { INTERVIEWER_AI, type InterviewerAi } from '@/modules/sessions';
import { transition } from '@/modules/sessions';
import { LlmGateway } from '@/modules/llm-gateway';
import { PRACTICE_CONSENT_TEXT_VERSION } from './consent-text';
import { findPack } from './library';
import { PRACTICE_DAILY_COMPLETION_CAP } from './readiness';
import { PracticeEvaluationService } from './practice-evaluation.service';
import {
  PracticeSessionRepository,
  type PracticeSessionRecord,
} from './practice-session.repository';
import { PracticeTranscriptRepository } from './practice-transcript.repository';

export { PRACTICE_DAILY_COMPLETION_CAP };

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
    private readonly creditsAlert: CreditsAlertService,
    private readonly evaluation: PracticeEvaluationService,
    @Inject(INTERVIEWER_AI) private readonly conductor: InterviewerAi,
    private readonly llmGateway: LlmGateway,
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
    if (body.mode !== 'text' && body.mode !== 'voice' && body.mode !== 'live') {
      throw new ApiException(400, 'VALIDATION_ERROR', 'mode must be text, voice or live');
    }
    void requestMeta; // ip/ua captured at consent time
    return this.insertNewSession(accountId, body.mode, 'library', pack.title, pack.questions);
  }

  /**
   * JD-targeted mock (Phase 12, D10): the practice_kit_from_jd LLM task builds
   * a question set from the pasted JD (+ the candidate's resume text when one
   * is stored), which becomes the session snapshot with source 'jd'. The LLM
   * call runs OUTSIDE the transaction; only the insert is transactional, and
   * the D11 daily-cap check runs inside it like library sessions.
   */
  async createFromJd(
    accountId: string,
    body: { jdText: string; mode: PracticeMode; resumeText?: string | null },
  ): Promise<{ session: PracticeSessionRecord; recoveryToken: string }> {
    const jdText = typeof body?.jdText === 'string' ? body.jdText.trim() : '';
    if (jdText.length < 40) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'jdText must be at least 40 characters');
    }
    if (body.mode !== 'text' && body.mode !== 'voice' && body.mode !== 'live') {
      throw new ApiException(400, 'VALIDATION_ERROR', 'mode must be text, voice or live');
    }
    const result = await this.llmGateway.complete<{ questions: ProposedQuestion[] }>({
      task: 'practice_kit_from_jd',
      variables: {
        jdText,
        resumeText: typeof body.resumeText === 'string' ? body.resumeText : '',
      },
      // orgId is the candidate account id — pure attribution label (D9).
      orgId: accountId,
    });
    const questions = result.parsed.questions ?? [];
    if (questions.length === 0) {
      throw new ApiException(
        502,
        'KIT_GENERATION_FAILED',
        'the question generator returned no questions',
      );
    }
    const titleLine =
      jdText
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? 'JD practice';
    const title = `JD practice: ${titleLine.slice(0, 80)}`;
    return this.insertNewSession(
      accountId,
      body.mode,
      'jd',
      title,
      questions.map(toPracticeKitQuestion),
    );
  }

  /** Shared insert for create()/createFromJd(): D11 cap check + row + recovery token. */
  private async insertNewSession(
    accountId: string,
    mode: PracticeMode,
    source: 'library' | 'jd',
    title: string,
    questions: KitQuestion[],
  ): Promise<{ session: PracticeSessionRecord; recoveryToken: string }> {
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
          mode,
          source,
          title,
          snapshot: { questions },
          creditAccountId,
          recoveryTokenHash: TokenService.hash(rawRecovery),
        },
        q,
      );
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
    const result: {
      session: PracticeSessionRecord;
      turn: SessionTurnResponse;
      balanceAfter: number | null;
    } = await this.db.transaction(
      async (
        q,
      ): Promise<{
        session: PracticeSessionRecord;
        turn: SessionTurnResponse;
        balanceAfter: number | null;
      }> => {
        let session = await this.loadByRecoveryToken(sessionId, rawRecoveryToken, q);
        this.assertOwned(session, accountId);

        if (session.status === 'live') {
          return { ...(await this.buildNextTurn(q, session)), balanceAfter: null };
        }
        // X8 gate runs before the state check so a never-consented session
        // reports the actionable error: no consent artifact → no live
        // transition (409, never silent).
        const consentRow = await q.query(
          `SELECT id FROM practice_consent WHERE session_id = $1 LIMIT 1`,
          [sessionId],
        );
        if ((consentRow.rowCount ?? 0) === 0) {
          throw new ApiException(
            409,
            'CONSENT_REQUIRED',
            'consent must be recorded before starting',
          );
        }
        if (session.status !== 'consented' && session.status !== 'preflight') {
          throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
        }

        // Charge point — atomic claim so concurrent prefights (React StrictMode
        // double-mount fires two back to back) debit exactly once: the first
        // transaction to flip consented/preflight → live wins; losers replay
        // idempotently without a second debit (verified by integration test:
        // sequential and interleaved prefights charge a single 3-credit debit).
        const claimed = await this.sessions.claimLive(session.id, new Date(), q);
        if (!claimed) {
          session = await this.loadByRecoveryToken(sessionId, rawRecoveryToken, q);
          if (session.status === 'live') {
            return { ...(await this.buildNextTurn(q, session)), balanceAfter: null };
          }
          throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
        }
        session = claimed;

        // Live practice runs the real LiveKit room (camera + orchestrator
        // agent), so it is priced like a video interview.
        const price = priceForKind(session.mode === 'live' ? 'video' : session.mode);
        await assertCanStart(
          (id) => this.credits.getBalance(id, q),
          session.creditAccountId,
          price,
        );
        const charge = await this.credits.debit(
          session.creditAccountId,
          price,
          'practice_start',
          q,
          { metadata: { mode: session.mode, source: session.source } },
        );
        return { ...(await this.buildNextTurn(q, session)), balanceAfter: charge.balanceAfter };
      },
    );
    const balanceAfter = result.balanceAfter;
    if (balanceAfter !== null) {
      // Fire-and-forget alert (≤1/24h watermark inside the service).
      await this.creditsAlert.maybeAlertLowBalance(result.session.creditAccountId, balanceAfter);
    }
    if (result.session.status === 'completed') {
      await this.evaluation.evaluateSession(result.session.id);
    }
    return result;
  }

  async turn(
    accountId: string,
    sessionId: string,
    rawRecoveryToken: string,
    body?: { answer?: string; recordingRef?: string },
  ): Promise<{ session: PracticeSessionRecord; turn: SessionTurnResponse }> {
    const result = await this.db.transaction(async (q) => {
      const session = await this.loadByRecoveryToken(sessionId, rawRecoveryToken, q);
      this.assertOwned(session, accountId);
      return this.applyTurn(q, session, body);
    });
    return this.afterTurn(result);
  }

  /**
   * Orchestrator-facing turn (live practice, Phase 12e): the recovery token
   * IS the credential — same trust posture as the company-interview conductor
   * endpoint (/sessions/:id/turn). No account-ownership check on top, and the
   * endpoint is recovery-token-only, so it can never double as a candidate
   * JWT route.
   */
  async turnByRecoveryToken(
    sessionId: string,
    rawRecoveryToken: string,
    body?: { answer?: string; recordingRef?: string },
  ): Promise<{ session: PracticeSessionRecord; turn: SessionTurnResponse }> {
    const result = await this.db.transaction(async (q) => {
      const session = await this.loadByRecoveryToken(sessionId, rawRecoveryToken, q);
      return this.applyTurn(q, session, body);
    });
    return this.afterTurn(result);
  }

  private async applyTurn(
    q: Queryable,
    session: PracticeSessionRecord,
    body?: { answer?: string; recordingRef?: string },
  ): Promise<{ session: PracticeSessionRecord; turn: SessionTurnResponse }> {
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
      await this.transcript.answer(
        lastRow.id,
        answer,
        q,
        body?.recordingRef
          ? { type: 'open_ended', practiceRecording: { objectName: body.recordingRef } }
          : undefined,
      );
    }
    const refreshed = (await this.sessions.findById(session.id, q)) as PracticeSessionRecord;
    return this.buildNextTurn(q, refreshed);
  }

  private async afterTurn(result: {
    session: PracticeSessionRecord;
    turn: SessionTurnResponse;
  }): Promise<{ session: PracticeSessionRecord; turn: SessionTurnResponse }> {
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

  /**
   * Live practice token (Phase 12e): hands the Ascend client a LiveKit room
   * token + orchestrator WS for a 'live'-mode practice session. The session
   * must already be 'live' (preflight charged the start debit). The
   * orchestrator drives turns through the recovery-token-only conductor
   * routes, so the recovery token is forwarded for its conductor calls.
   */
  async issueLiveToken(
    accountId: string,
    sessionId: string,
    rawRecoveryToken: string,
  ): Promise<PracticeLiveTokenResponse> {
    const session = await this.loadByRecoveryToken(sessionId, rawRecoveryToken, this.db);
    this.assertOwned(session, accountId);
    if (session.mode !== 'live') {
      throw new ApiException(409, 'SESSION_MODE_INVALID', 'session is not a live practice session');
    }
    if (session.status !== 'live') {
      throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
    }

    const orchestratorBaseUrl = process.env.ORCHESTRATOR_URL ?? 'http://ai-orchestrator:8000';
    let response: Response;
    try {
      response = await fetch(`${orchestratorBaseUrl}/voice/sessions/${sessionId}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryToken: rawRecoveryToken, mode: 'video', practice: true }),
      });
    } catch {
      throw new ApiException(502, 'ORCHESTRATOR_ERROR', 'orchestrator unreachable');
    }
    if (!response.ok) {
      throw new ApiException(
        502,
        'ORCHESTRATOR_ERROR',
        'orchestrator failed to issue live practice token',
      );
    }
    const payload = (await response.json()) as {
      livekit: { url: string; token: string; roomName: string };
      orchestrator: { wsUrl: string; token: string };
    };
    return { session, livekit: payload.livekit, orchestrator: payload.orchestrator };
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

  /** Audio-turn gate (voice practice): recovery-token load + ownership + live. */
  async loadLiveSession(
    accountId: string,
    sessionId: string,
    rawRecoveryToken: string,
  ): Promise<PracticeSessionRecord> {
    const session = await this.loadByRecoveryToken(sessionId, rawRecoveryToken, this.db);
    this.assertOwned(session, accountId);
    if (session.status !== 'live') {
      throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
    }
    return session;
  }

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
    extras?: { startedAt?: Date; completedAt?: Date },
  ): Promise<PracticeSessionRecord> {
    transition(session.status as InterviewSession['status'], to as InterviewSession['status']);
    const stamp =
      to === 'completed' && !extras?.completedAt ? { ...extras, completedAt: new Date() } : extras;
    const updated = await this.sessions.updateStatus(session.id, to, q, stamp);
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
    // The conductor adapter is InterviewSession-shaped; 'live' practice maps
    // to the 'video' media mode (the LLM only needs voice/video semantics).
    const mediaMode = session.mode === 'live' ? 'video' : session.mode;
    const snapshot: KitSnapshot = {
      schemaVersion: 1,
      kit: {
        id: `practice-${session.id}`,
        title: session.title,
        role: null,
        level: null,
        settings: {
          mode: mediaMode,
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
      mode: mediaMode,
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
    // Replay safety: when a question is already pending (unanswered last
    // row), re-present it instead of asking the conductor again. Repeated
    // preflight replays (React StrictMode double-mount, tab refresh) used to
    // insert a fresh transcript row per call, which advanced the session and
    // could wrap it up before the candidate answered anything.
    const lastRow = rows[rows.length - 1] ?? null;
    if (lastRow && lastRow.answerText === null) {
      const askedForQuestion = rows.filter((t) => t.questionId === lastRow.questionId).length;
      return {
        session,
        turn: {
          type: askedForQuestion > 1 ? 'followup' : 'question',
          text: lastRow.questionPrompt,
          questionId: lastRow.questionId,
        },
      };
    }
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

/** Map a JD-generated proposed question onto the practice KitQuestion shape. */
function toPracticeKitQuestion(proposed: ProposedQuestion, index: number): KitQuestion {
  return {
    id: `jd-q${index + 1}-${proposed.topic.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    kitId: 'practice-jd',
    topic: proposed.topic,
    position: String(index + 1),
    type: proposed.type,
    prompt: proposed.prompt,
    options: proposed.options,
    difficulty: proposed.difficulty,
    timeLimitSec: proposed.timeLimitSec,
    timeLimitType: proposed.timeLimitType,
    mandatory: proposed.mandatory,
    followupPolicy: proposed.followupPolicy,
    followupFixed: proposed.followupFixed,
    followupDepthCap: proposed.followupDepthCap,
    rubricLines: proposed.rubricLines,
    source: 'jd_generated',
    sourceRef: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

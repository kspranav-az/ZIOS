import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AppUser,
  Candidate,
  InterviewSession,
  Invite,
  KitQuestion,
  KitSnapshot,
  SessionTranscript,
} from '@zios/shared-types';
import { ApiException, assertValidEmail } from '@/common/errors';
import { TokenService } from '@/common/tokens';
import { CandidatesRepository } from '@/modules/candidates';
import { ConsentService } from '@/modules/consent';
import { DatabaseService, type Queryable } from '@/modules/database';
import { InvitesRepository } from '@/modules/invites';
import { KitVersionsRepository } from '@/modules/kits';
import { SessionsRepository, TranscriptRepository, transition } from '@/modules/sessions';
import { CreditsService } from '@/modules/credits';
import {
  EvaluationRepository,
  EvaluationScoreRepository,
  EvidenceSpanRepository,
  computeCommunicationMetrics,
  JUDGE_PORT,
  type JudgePort,
} from '@/modules/evaluation';
import { StorageClient } from '@/modules/storage';
import { AnalysisService, type AnalysisJobRecord } from '@/modules/analysis';
import { AsyncVideoTranscriptionService } from './transcription.service';
import { RoleKitResolverService } from './role-kit-resolver.service';
import { TranscriptionDlqService } from './transcription-dlq.service';
import { TranscriptionQueue } from './transcription.queue';

const ZETHEETA_ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const SYSTEM_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
const DEFAULT_EXPIRY_DAYS = 180;
const DEFAULT_MAX_DURATION_SEC = 180;
const ASYNC_VIDEO_CREDIT_COST = 3;

export interface CreateAsyncVideoInterviewInput {
  roleId: number;
  orgId?: string;
  candidate: {
    name: string;
    email: string;
    phone?: string;
    externalRef?: string;
  };
  expiresInDays?: number;
  maxDurationSec?: number;
  enableTranscription?: boolean;
  enableAnalysis?: boolean;
  enableProctoring?: boolean;
}

export interface PostUploadPlan {
  /** Enqueue a multimodal_feature_extraction analysis job (default on). */
  analysis: boolean;
  /** Ask the orchestrator to also produce a transcript (written back to the answer row). */
  includeTranscript: boolean;
  /** Use the legacy transcription_job path (only when analysis is disabled). */
  legacyTranscription: boolean;
}

/**
 * Post-upload processing plan for a video answer, derived from invite
 * metadata. Analysis is the default (Phase 14); `enableAnalysis: false`
 * keeps the legacy transcription-only path for older invite configurations.
 */
export function resolvePostUploadPlan(
  metadata: Record<string, unknown> | undefined,
): PostUploadPlan {
  const enableAnalysis = metadata?.enableAnalysis !== false;
  const enableTranscription = metadata?.enableTranscription === true;
  if (enableAnalysis) {
    return { analysis: true, includeTranscript: enableTranscription, legacyTranscription: false };
  }
  return { analysis: false, includeTranscript: false, legacyTranscription: enableTranscription };
}

export interface AsyncVideoInterviewCreated {
  sessionId: string;
  inviteId: string;
  candidateId: string;
  token: string;
  recoveryToken: string;
  expiresAt: string;
  questions: KitQuestion[];
}

export interface AsyncConsentInput {
  name?: string;
  email?: string;
  phone?: string;
  noticeText?: string;
}

export interface AsyncConsentResult {
  session: InterviewSession;
  recoveryToken: string;
}

export interface AsyncQuestionsResult {
  session: InterviewSession;
  questions: KitQuestion[];
  answers: SessionTranscript[];
  maxDurationSec: number;
}

export interface AsyncUploadResult {
  transcriptId: string;
  recordingUri: string;
  checksum: string;
  completed?: boolean;
}

export interface AsyncReviewResult {
  session: InterviewSession;
  candidate: Candidate;
  invite: Invite;
  questions: KitQuestion[];
  answers: SessionTranscript[];
  scores: AsyncReviewScoreRow[];
}

export interface AsyncReviewScoreRow {
  id: string;
  sessionId: string;
  questionId: string;
  score: number | null;
  remarks: string | null;
  reviewedBy: string | null;
  source?: 'human' | 'ai_prefill';
  scorerId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AsyncScoreInput {
  score?: number;
  remarks?: string;
}

interface VideoAnswerData {
  type: 'video_answer';
  videoAnswer: {
    recordingUri: string;
    objectName: string;
    checksum: string;
    sizeBytes: number;
    durationSec?: number;
    transcript?: string;
  };
}

@Injectable()
export class AsyncVideoInterviewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly candidates: CandidatesRepository,
    private readonly invites: InvitesRepository,
    private readonly sessions: SessionsRepository,
    private readonly transcript: TranscriptRepository,
    private readonly versions: KitVersionsRepository,
    private readonly consent: ConsentService,
    private readonly storage: StorageClient,
    private readonly transcription: AsyncVideoTranscriptionService,
    private readonly roleKitResolver: RoleKitResolverService,
    private readonly transcriptionQueue: TranscriptionQueue,
    private readonly transcriptionDlq: TranscriptionDlqService,
    private readonly analysis: AnalysisService,
    private readonly credits: CreditsService,
    @Inject(JUDGE_PORT) private readonly judge: JudgePort,
    private readonly reports: EvaluationRepository,
    private readonly scores: EvaluationScoreRepository,
    private readonly evidenceSpans: EvidenceSpanRepository,
  ) {}

  async create(input: CreateAsyncVideoInterviewInput): Promise<AsyncVideoInterviewCreated> {
    const orgId = input.orgId?.trim() || ZETHEETA_ORG_ID;
    const email = input.candidate.email.trim().toLowerCase();
    assertValidEmail(email);
    const name = input.candidate.name.trim();
    if (!name) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'candidate name is required');
    }

    const maxDurationSec =
      typeof input.maxDurationSec === 'number' && input.maxDurationSec > 0
        ? input.maxDurationSec
        : DEFAULT_MAX_DURATION_SEC;
    const expiresInDays =
      typeof input.expiresInDays === 'number' && input.expiresInDays > 0
        ? input.expiresInDays
        : DEFAULT_EXPIRY_DAYS;

    return this.db.transaction(async (q) => {
      await this.credits.debit(orgId, ASYNC_VIDEO_CREDIT_COST, 'async_video_created', q, {
        metadata: { roleId: input.roleId },
      });

      const { versionId, questions } = await this.roleKitResolver.resolveKitVersionId(
        orgId,
        input.roleId,
        SYSTEM_USER_ID,
        q,
      );

      let candidate = await this.candidates.findByEmail(orgId, email, q);
      if (!candidate) {
        candidate = await this.candidates.insert(
          {
            orgId,
            name,
            email,
            phone: input.candidate.phone,
            externalRef: input.candidate.externalRef,
          },
          q,
        );
      }

      const rawToken = TokenService.generateRaw();
      const tokenHash = TokenService.hash(rawToken);
      const rawRecovery = TokenService.generateRaw();
      const recoveryTokenHash = TokenService.hash(rawRecovery);
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

      const invite = await this.invites.insert(
        {
          orgId,
          kitVersionId: versionId,
          candidateId: candidate.id,
          tokenHash,
          expiresAt,
          otpRequired: false,
          conductor: 'ai',
          metadata: {
            asyncVideo: true,
            maxDurationSec,
            enableTranscription: input.enableTranscription === true,
            enableAnalysis: input.enableAnalysis !== false,
            enableProctoring: input.enableProctoring === true,
          },
        },
        q,
      );

      const session = await this.sessions.insert(
        {
          inviteId: invite.id,
          kitVersionId: versionId,
          mode: 'video',
          conductor: 'ai',
          status: 'invited',
          recoveryTokenHash,
        },
        q,
      );

      await this.seedTranscriptRows(q, session.id, questions);

      return {
        sessionId: session.id,
        inviteId: invite.id,
        candidateId: candidate.id,
        token: rawToken,
        recoveryToken: rawRecovery,
        expiresAt: expiresAt.toISOString(),
        questions,
      };
    });
  }

  async consentByToken(
    rawToken: string,
    body: AsyncConsentInput = {},
  ): Promise<AsyncConsentResult> {
    const tokenHash = TokenService.hash(rawToken);
    return this.db.transaction(async (q) => {
      const invite = await this.invites.findByTokenHash(tokenHash, q);
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
      if (new Date() > new Date(invite.expiresAt)) {
        throw new ApiException(410, 'INVITE_EXPIRED', 'this invite link has expired');
      }
      if (!invite.metadata?.asyncVideo) {
        throw new ApiException(
          400,
          'INVALID_INVITE_TYPE',
          'this invite is not for an async video interview',
        );
      }

      const candidate = await this.candidates.findById(invite.orgId, invite.candidateId, q);
      if (!candidate) {
        throw new ApiException(404, 'CANDIDATE_NOT_FOUND', 'candidate not found');
      }

      await this.candidates.update(
        invite.orgId,
        candidate.id,
        {
          name: body.name?.trim() || candidate.name,
          email: body.email?.trim().toLowerCase() || candidate.email,
          phone: body.phone !== undefined ? body.phone.trim() : candidate.phone,
        },
        q,
      );

      const consent = await this.consent.createForInvite(
        {
          inviteId: invite.id,
          subjectId: candidate.email,
          noticeText: body.noticeText,
        },
        q,
      );

      let session = await this.sessions.findByInviteId(invite.id, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }

      await this.sessions.setConsentId(session.id, consent.id, q);

      if (session.status === 'invited') {
        session = await this.advanceStatus(q, session, 'consented');
      }
      if (session.status === 'consented') {
        session = await this.advanceStatus(q, session, 'preflight');
      }
      if (session.status === 'preflight') {
        session = await this.advanceStatus(q, session, 'live', { startedAt: new Date() });
      }

      if (session.status !== 'live') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }

      const rawRecovery = TokenService.generateRaw();
      const newRecoveryHash = TokenService.hash(rawRecovery);
      await q.query(
        'UPDATE interview_session SET recovery_token_hash = $1, updated_at = now() WHERE id = $2',
        [newRecoveryHash, session.id],
      );

      const refreshed = await this.sessions.findById(session.id, q);
      return { session: refreshed as InterviewSession, recoveryToken: rawRecovery };
    });
  }

  async getQuestions(sessionId: string, rawRecoveryToken: string): Promise<AsyncQuestionsResult> {
    return this.db.transaction(async (q) => {
      const session = await this.loadAuthorizedSession(sessionId, rawRecoveryToken, q);
      if (session.status === 'completed') {
        throw new ApiException(
          409,
          'SESSION_COMPLETED',
          'this interview has already been completed',
        );
      }
      const snapshot = await this.loadSnapshot(session.kitVersionId, q);
      const answers = await this.transcript.listBySession(sessionId, q);
      const maxDurationSec = await this.loadMaxDurationSec(session.inviteId, q);
      return { session, questions: snapshot.questions, answers, maxDurationSec };
    });
  }

  async uploadVideoAnswer(
    sessionId: string,
    questionId: string,
    rawRecoveryToken: string,
    videoBuffer: Buffer,
    opts?: { durationSec?: number },
  ): Promise<AsyncUploadResult> {
    // 1. Persist the answer and the transcription job row in a single transaction.
    const uploadResult = await this.db.transaction(async (q) => {
      const session = await this.loadAuthorizedSession(sessionId, rawRecoveryToken, q);
      if (session.status !== 'live') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }

      const rows = await this.transcript.listBySession(sessionId, q);
      const row = rows.find((r) => r.questionId === questionId);
      if (!row) {
        throw new ApiException(404, 'QUESTION_NOT_FOUND', 'question not found in this session');
      }

      const { uri, checksum } = await this.storage.uploadRecording(
        `async-video/${sessionId}/${questionId}`,
        videoBuffer,
      );

      const objectName = `async-video/${sessionId}/${questionId}/${checksum}.webm`;
      const answerData: VideoAnswerData = {
        type: 'video_answer',
        videoAnswer: {
          recordingUri: uri,
          objectName,
          checksum,
          sizeBytes: videoBuffer.length,
          durationSec: opts?.durationSec,
        },
      };

      await this.transcript.answer(
        row.id,
        '',
        q,
        undefined,
        answerData as unknown as import('@zios/shared-types').AnswerData,
      );
      await this.sessions.appendMediaRef(
        sessionId,
        {
          kind: 'async_video_answer',
          questionId,
          objectName,
          checksum,
          recordedAt: new Date().toISOString(),
        },
        q,
      );

      let transcriptionEnqueued = false;
      let analysisJob: AnalysisJobRecord | null = null;
      const inviteMetadata = await this.loadInviteMetadata(session.inviteId, q);
      const plan = resolvePostUploadPlan(inviteMetadata);
      if (plan.analysis) {
        analysisJob = await this.analysis.enqueueMultimodalAnalysis(
          {
            sessionId,
            questionId,
            inviteId: session.inviteId,
            objectName,
            mediaKind: 'video',
            includeTranscript: plan.includeTranscript,
          },
          q,
        );
      } else if (plan.legacyTranscription) {
        const jobId = randomUUID();
        await q.query(
          `INSERT INTO transcription_job (id, transcript_id, object_name, status)
           VALUES ($1, $2, $3, 'pending')`,
          [jobId, row.id, objectName],
        );
        transcriptionEnqueued = true;
      }

      const remainingResult = await q.query(
        `SELECT COUNT(*) AS count
         FROM session_transcript
         WHERE session_id = $1 AND answer_data IS NULL`,
        [sessionId],
      );
      const remainingCount = Number((remainingResult.rows[0] as { count: string }).count);
      let completed = false;
      if (remainingCount === 0) {
        completed = true;
        await this.advanceStatus(q, session, 'completed');
        await q.query("UPDATE invite SET status = 'completed', updated_at = now() WHERE id = $1", [
          session.inviteId,
        ]);
      }

      return {
        transcriptId: row.id,
        recordingUri: uri,
        checksum,
        completed,
        transcriptionEnqueued,
        analysisJob,
        objectName,
        sessionId,
        questionId,
        inviteId: session.inviteId,
      };
    });

    // 2. Enqueue the background job only after the transaction has committed so
    //    the worker never races with an uncommitted answer row.
    if (uploadResult.analysisJob) {
      await this.analysis.enqueueAfterCommit(uploadResult.analysisJob);
    } else if (uploadResult.transcriptionEnqueued) {
      await this.transcriptionQueue.add({
        transcriptId: uploadResult.transcriptId,
        objectName: uploadResult.objectName,
        sessionId: uploadResult.sessionId,
        questionId: uploadResult.questionId,
        inviteId: uploadResult.inviteId,
      });
    }

    return {
      transcriptId: uploadResult.transcriptId,
      recordingUri: uploadResult.recordingUri,
      checksum: uploadResult.checksum,
      completed: uploadResult.completed,
    };
  }

  async getReview(orgId: string, sessionId: string): Promise<AsyncReviewResult> {
    return this.db.transaction(async (q) => {
      const session = await this.sessions.findById(sessionId, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      const invite = await this.invites.findById(orgId, session.inviteId, q);
      if (!invite) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      const candidate = await this.candidates.findById(orgId, invite.candidateId, q);
      if (!candidate) {
        throw new ApiException(404, 'CANDIDATE_NOT_FOUND', 'candidate not found');
      }
      const snapshot = await this.loadSnapshot(session.kitVersionId, q);
      const answers = await this.transcript.listBySession(sessionId, q);
      const scores = await this.listScores(sessionId, q);
      return { session, candidate, invite, questions: snapshot.questions, answers, scores };
    });
  }

  /**
   * Admin redrive of a DLQ'd transcription job: resets the job to pending and
   * re-enqueues it on the transcription queue. Org-scoped like the review
   * endpoints; the BullMQ job is added only after the reset transaction
   * commits.
   */
  async redriveTranscription(
    orgId: string,
    transcriptId: string,
  ): Promise<{ transcriptId: string; sessionId: string; requeued: true }> {
    const plan = await this.db.transaction(async (q) => {
      const dlq = await this.transcriptionDlq.findByTranscriptId(transcriptId, q);
      if (!dlq) {
        throw new ApiException(404, 'DLQ_JOB_NOT_FOUND', 'no DLQ row for this transcript');
      }
      const session = await this.sessions.findById(dlq.sessionId, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      const invite = await this.invites.findById(orgId, session.inviteId, q);
      if (!invite) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      const redriven = await this.transcriptionDlq.redriveFromDlq(transcriptId, q);
      return {
        transcriptId,
        sessionId: redriven.sessionId,
        inviteId: session.inviteId,
        objectName: redriven.objectName,
        questionId: redriven.questionId,
        requeued: true as const,
      };
    });
    await this.transcriptionQueue.add({
      transcriptId: plan.transcriptId,
      objectName: plan.objectName,
      sessionId: plan.sessionId,
      questionId: plan.questionId,
      inviteId: plan.inviteId,
    });
    return { transcriptId: plan.transcriptId, sessionId: plan.sessionId, requeued: true };
  }

  async submitScore(
    orgId: string,
    sessionId: string,
    questionId: string,
    user: AppUser,
    input: AsyncScoreInput,
  ): Promise<AsyncReviewScoreRow> {
    return this.db.transaction(async (q) => {
      const session = await this.sessions.findById(sessionId, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      const invite = await this.invites.findById(orgId, session.inviteId, q);
      if (!invite) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      if (input.score !== undefined && (input.score < 1 || input.score > 5)) {
        throw new ApiException(400, 'VALIDATION_ERROR', 'score must be between 1 and 5');
      }

      const result = await q.query(
        `INSERT INTO async_video_review_score (session_id, question_id, score, remarks, reviewed_by, source, scorer_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id, question_id)
         DO UPDATE SET score = EXCLUDED.score,
                       remarks = EXCLUDED.remarks,
                       reviewed_by = EXCLUDED.reviewed_by,
                       source = EXCLUDED.source,
                       scorer_id = EXCLUDED.scorer_id,
                       updated_at = now()
         RETURNING id, session_id, question_id, score, remarks, reviewed_by, source, scorer_id, created_at, updated_at`,
        [
          sessionId,
          questionId,
          input.score ?? null,
          input.remarks ?? null,
          user.id,
          'human',
          user.id,
        ],
      );
      const row = result.rows[0] as Record<string, unknown>;
      return this.mapScoreRow(row);
    });
  }

  /**
   * AI judge pre-fill for the async video scorecard. Runs the shared judge port
   * over the recorded answers and writes suggested scores into
   * async_video_review_score with source='ai_prefill'. The human reviewer can
   * edit these before submitting the scorecard.
   */
  async prefillScorecard(
    orgId: string,
    sessionId: string,
    user: AppUser,
  ): Promise<AsyncReviewResult> {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
    }
    const invite = await this.invites.findById(orgId, session.inviteId);
    if (!invite) {
      throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
    }
    if (!invite.metadata?.asyncVideo) {
      throw new ApiException(400, 'INVALID_INVITE_TYPE', 'not an async video interview');
    }

    const transcript = await this.loadTranscript(sessionId);
    const questions = await this.loadQuestions(session.kitVersionId);
    const judgeResult = await this.judge.evaluate(
      { orgId, sessionId: session.id, kitVersionId: session.kitVersionId },
      transcript,
      questions,
    );

    await this.db.transaction(async (q) => {
      // Group judge scores by question and store one async_video_review_score row
      // per question using the weighted average of criterion scores.
      const scoresByQuestion = new Map<string, { sum: number; weight: number; evidence: string }>();
      for (const score of judgeResult.scores) {
        const current = scoresByQuestion.get(score.questionId) ?? {
          sum: 0,
          weight: 0,
          evidence: '',
        };
        current.sum += score.score * score.weight;
        current.weight += score.weight;
        if (!current.evidence && score.evidenceSpan.quoteText) {
          current.evidence = score.evidenceSpan.quoteText;
        }
        scoresByQuestion.set(score.questionId, current);
      }

      for (const [questionId, aggregate] of scoresByQuestion.entries()) {
        const weightedScore = aggregate.weight > 0 ? aggregate.sum / aggregate.weight : 0;
        const score = Math.max(1, Math.min(5, Math.round(weightedScore)));
        await q.query(
          `INSERT INTO async_video_review_score (session_id, question_id, score, remarks, reviewed_by, source, scorer_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (session_id, question_id)
           DO UPDATE SET score = EXCLUDED.score,
                         remarks = EXCLUDED.remarks,
                         reviewed_by = EXCLUDED.reviewed_by,
                         source = EXCLUDED.source,
                         scorer_id = EXCLUDED.scorer_id,
                         updated_at = now()`,
          [
            sessionId,
            questionId,
            score,
            aggregate.evidence || null,
            user.id,
            'ai_prefill',
            user.id,
          ],
        );
      }
    });

    return this.getReview(orgId, sessionId);
  }

  /**
   * Submits the async video scorecard, creating a completed evaluation_report
   * with the same schema as live-mode reports.
   */
  async submitScorecard(
    orgId: string,
    sessionId: string,
    user: AppUser,
    opts?: { prefillAccepted?: boolean; editCount?: number },
  ) {
    return this.db.transaction(async (q) => {
      let session = await this.sessions.findById(sessionId, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      const invite = await this.invites.findById(orgId, session.inviteId, q);
      if (!invite) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      if (!invite.metadata?.asyncVideo) {
        throw new ApiException(400, 'INVALID_INVITE_TYPE', 'not an async video interview');
      }

      const scores = await this.listScores(sessionId, q);
      if (scores.length === 0) {
        throw new ApiException(400, 'SCORECARD_EMPTY', 'no scores to submit');
      }
      const unscored = scores.filter((s) => s.score === null);
      if (unscored.length > 0) {
        throw new ApiException(400, 'SCORECARD_INCOMPLETE', 'all questions must be scored');
      }

      const transcript = await this.loadTranscript(sessionId);
      const questions = await this.loadQuestions(session.kitVersionId);
      const metrics = computeCommunicationMetrics(transcript);

      const weightedScore = scores.reduce((sum, s) => sum + (s.score ?? 0), 0) / scores.length;
      const overallRecommendation = Math.max(1, Math.min(5, Math.round(weightedScore)));

      // Use the live-mode evaluation pipeline to create/update the report.
      let report = await this.reports.findBySessionId(sessionId, q);
      if (!report) {
        report = await this.reports.insert(
          {
            orgId,
            sessionId,
            inviteId: invite.id,
            kitVersionId: session.kitVersionId,
            status: 'pending',
            modelRoute: 'async-video-scorecard',
          },
          q,
        );
      }

      await this.scores.deleteByReportId(report.id, q);
      await this.evidenceSpans.deleteByReportId(report.id, q);

      // Build simple evidence spans from the remarks/human input or transcript.
      const spanIdByQuestion = new Map<string, string>();
      for (const score of scores) {
        const transcriptRow = transcript.find((t) => t.questionId === score.questionId);
        const quoteText = score.remarks?.trim() || transcriptRow?.answerText || '';
        const span = await this.evidenceSpans.insert(
          {
            reportId: report.id,
            transcriptId: transcriptRow?.id ?? null,
            questionId: score.questionId,
            start: 0,
            end: quoteText.length,
            quoteText,
          },
          q,
        );
        spanIdByQuestion.set(score.questionId, span.id);
      }

      const questionMap = new Map<string, KitQuestion>(
        questions.map((question) => [question.id, question]),
      );
      for (const score of scores) {
        const question = questionMap.get(score.questionId);
        const spanId = spanIdByQuestion.get(score.questionId);
        if (!spanId) {
          throw new Error(`missing evidence span for question ${score.questionId}`);
        }
        await this.scores.insert(
          {
            reportId: report.id,
            questionId: score.questionId,
            criterionId: 'overall',
            criterionText: question?.rubricLines?.[0]?.text ?? 'Overall assessment',
            score: score.score ?? 0,
            weight: 1,
            evidenceSpanIds: [spanId],
            source: score.source ?? 'human',
            scorerId: score.scorerId ?? user.id,
          },
          q,
        );
      }

      await this.reports.updateScorecard(
        report.id,
        {
          overallRecommendation,
          overallConfidence: 0.7,
          communicationMetrics: metrics,
          cost: 0,
          promptVersions: { source: 'async-video-scorecard' },
          scorecardMeta: {
            submittedAt: new Date().toISOString(),
            submittedBy: user.id,
            prefillAccepted: opts?.prefillAccepted ?? false,
            editCount: opts?.editCount ?? 0,
          },
        },
        q,
      );

      session = await this.advanceStatus(q, session, 'scoring');
      session = await this.advanceStatus(q, session, 'reported');

      return this.reports.findById(report.id, q);
    });
  }

  /**
   * Refunds the async-video credit cost if and only if no video answers have
   * been uploaded yet. Once an answer exists, the session is considered
   * consumed and no refund is issued.
   */
  async refundCredits(orgId: string, sessionId: string): Promise<{ refunded: boolean }> {
    return this.db.transaction(async (q) => {
      const session = await this.sessions.findById(sessionId, q);
      if (!session) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      const invite = await this.invites.findById(orgId, session.inviteId, q);
      if (!invite) {
        throw new ApiException(404, 'INVITE_NOT_FOUND', 'invite not found');
      }
      if (!invite.metadata?.asyncVideo) {
        throw new ApiException(400, 'INVALID_INVITE_TYPE', 'not an async video interview');
      }

      const answersResult = await q.query(
        `SELECT COUNT(*) AS count
         FROM session_transcript
         WHERE session_id = $1 AND answer_data IS NOT NULL`,
        [sessionId],
      );
      const answeredCount = Number((answersResult.rows[0] as { count: string }).count);
      if (answeredCount > 0) {
        return { refunded: false };
      }

      await this.credits.credit(
        orgId,
        ASYNC_VIDEO_CREDIT_COST,
        'async_video_refund_no_answers',
        q,
        { sessionRef: sessionId },
      );
      return { refunded: true };
    });
  }

  /* ---- helpers ---- */

  private async seedTranscriptRows(q: Queryable, sessionId: string, questions: KitQuestion[]) {
    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i];
      if (!question) continue;
      await this.transcript.insert(
        {
          sessionId,
          questionId: question.id,
          questionPrompt: question.prompt,
          position: i,
        },
        q,
      );
    }
  }

  private async loadAuthorizedSession(
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
    const version = await this.versions.findById(kitVersionId, q);
    if (!version) {
      throw new ApiException(404, 'KIT_VERSION_NOT_FOUND', 'kit version not found');
    }
    return version.snapshot;
  }

  private async loadQuestions(kitVersionId: string, q?: Queryable): Promise<KitQuestion[]> {
    const snapshot = await this.loadSnapshot(kitVersionId, q ?? this.db);
    return snapshot.questions;
  }

  private async loadTranscript(sessionId: string, q?: Queryable): Promise<SessionTranscript[]> {
    const queryable = q ?? this.db;
    const result = await queryable.query(
      `SELECT id, session_id, question_id, question_prompt, answer_text, answer_data, position, evidence_span, created_at, answered_at
       FROM session_transcript
       WHERE session_id = $1
       ORDER BY position ASC, created_at ASC`,
      [sessionId],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      questionId: row.question_id as string,
      questionPrompt: row.question_prompt as string,
      answerText: row.answer_text as string | null,
      answerData: (row.answer_data ?? null) as SessionTranscript['answerData'],
      position: row.position as number,
      evidenceSpan: (row.evidence_span ?? []) as Array<{
        start: number;
        end: number;
        transcriptId: string;
      }>,
      createdAt: (row.created_at as Date).toISOString(),
      answeredAt: row.answered_at ? (row.answered_at as Date).toISOString() : null,
    }));
  }

  private async advanceStatus(
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
    return updated;
  }

  private async loadMaxDurationSec(inviteId: string, q: Queryable): Promise<number> {
    const result = await q.query('SELECT metadata FROM invite WHERE id = $1', [inviteId]);
    const metadata = (result.rows[0] as { metadata: Record<string, unknown> } | undefined)
      ?.metadata;
    const value = metadata?.maxDurationSec;
    return typeof value === 'number' && value > 0 ? value : DEFAULT_MAX_DURATION_SEC;
  }

  private async loadInviteMetadata(
    inviteId: string,
    q: Queryable,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await q.query('SELECT metadata FROM invite WHERE id = $1', [inviteId]);
    return (result.rows[0] as { metadata: Record<string, unknown> } | undefined)?.metadata;
  }

  private async listScores(sessionId: string, q: Queryable): Promise<AsyncReviewScoreRow[]> {
    const result = await q.query(
      `SELECT id, session_id, question_id, score, remarks, reviewed_by, source, scorer_id, created_at, updated_at
       FROM async_video_review_score
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId],
    );
    return (result.rows as Record<string, unknown>[]).map((row) => this.mapScoreRow(row));
  }

  private mapScoreRow(row: Record<string, unknown>): AsyncReviewScoreRow {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      questionId: row.question_id as string,
      score: row.score as number | null,
      remarks: row.remarks as string | null,
      reviewedBy: row.reviewed_by as string | null,
      source: row.source as 'human' | 'ai_prefill' | undefined,
      scorerId: row.scorer_id as string | null | undefined,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }
}

import { Injectable } from '@nestjs/common';
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
import { StorageClient } from '@/modules/storage';
import { AsyncVideoTranscriptionService } from './transcription.service';
import { RoleKitResolverService } from './role-kit-resolver.service';

const ZETHEETA_ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const SYSTEM_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
const DEFAULT_EXPIRY_DAYS = 180;
const DEFAULT_MAX_DURATION_SEC = 180;

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
  enableProctoring?: boolean;
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
  transcript?: string;
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
    return this.db.transaction(async (q) => {
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

      let transcriptText: string | undefined;
      const enableTranscription = await this.isTranscriptionEnabled(session.inviteId, q);
      if (enableTranscription) {
        const jobId = randomUUID();
        await q.query(
          `INSERT INTO transcription_job (id, transcript_id, object_name, status)
           VALUES ($1, $2, $3, 'pending')`,
          [jobId, row.id, objectName],
        );
        try {
          await q.query(`UPDATE transcription_job SET status = 'running' WHERE id = $1`, [jobId]);
          // The orchestrator downloads the stored video, extracts audio with
          // ffmpeg, and routes it through the configured STT port.
          transcriptText = await this.transcription.transcribe(objectName);
          await q.query(
            `UPDATE transcription_job
             SET status = 'completed', result = $1, completed_at = now()
             WHERE id = $2`,
            [transcriptText, jobId],
          );
          await this.transcript.answer(row.id, transcriptText, q, undefined, {
            ...answerData,
            videoAnswer: { ...answerData.videoAnswer, transcript: transcriptText },
          } as unknown as import('@zios/shared-types').AnswerData);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await q.query(
            `UPDATE transcription_job
             SET status = 'failed', error_message = $1, completed_at = now()
             WHERE id = $2`,
            [message, jobId],
          );
        }
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
        transcript: transcriptText,
        completed,
      };
    });
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
        `INSERT INTO async_video_review_score (session_id, question_id, score, remarks, reviewed_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id, question_id)
         DO UPDATE SET score = EXCLUDED.score,
                       remarks = EXCLUDED.remarks,
                       reviewed_by = EXCLUDED.reviewed_by,
                       updated_at = now()
         RETURNING id, session_id, question_id, score, remarks, reviewed_by, created_at, updated_at`,
        [sessionId, questionId, input.score ?? null, input.remarks ?? null, user.id],
      );
      const row = result.rows[0] as Record<string, unknown>;
      return this.mapScoreRow(row);
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

  private async isTranscriptionEnabled(inviteId: string, q: Queryable): Promise<boolean> {
    const result = await q.query('SELECT metadata FROM invite WHERE id = $1', [inviteId]);
    const metadata = (result.rows[0] as { metadata: Record<string, unknown> } | undefined)
      ?.metadata;
    return metadata?.enableTranscription === true;
  }

  private async listScores(sessionId: string, q: Queryable): Promise<AsyncReviewScoreRow[]> {
    const result = await q.query(
      `SELECT id, session_id, question_id, score, remarks, reviewed_by, created_at, updated_at
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
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }
}

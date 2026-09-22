import { Injectable } from '@nestjs/common';
import { ApiException } from '@/common/errors';
import type { Queryable } from '@/modules/database';
import { InvitesRepository } from '@/modules/invites';
import { SessionsRepository } from '@/modules/sessions';
import { AnalysisQueue, type AnalysisMediaKind } from './analysis.queue';
import { AnalysisRepository, type AnalysisJobRecord } from './analysis.repository';

export interface EnqueueAnalysisInput {
  sessionId: string;
  questionId: string | null;
  inviteId: string | null;
  objectName: string;
  mediaKind: AnalysisMediaKind;
  includeTranscript: boolean;
  languageHint?: string | null;
}

interface AnalysisJobPayload {
  objectName: string;
  mediaKind: AnalysisMediaKind;
  includeTranscript: boolean;
  languageHint: string | null;
}

export interface AnalysisJobSummary {
  id: string;
  kind: string;
  status: string;
  sessionId: string;
  questionId: string | null;
  schemaVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  media: unknown;
  metrics: unknown;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SessionAnalysisResult {
  sessionId: string;
  jobs: AnalysisJobSummary[];
}

export interface QuestionFeaturesResult {
  sessionId: string;
  questionId: string;
  analysisJobId: string;
  schemaVersion: string | null;
  features: unknown;
  media: unknown;
  completedAt: string | null;
}

@Injectable()
export class AnalysisService {
  constructor(
    private readonly repo: AnalysisRepository,
    private readonly queue: AnalysisQueue,
    private readonly sessions: SessionsRepository,
    private readonly invites: InvitesRepository,
  ) {}

  /**
   * Creates the durable analysis_job row inside the caller's transaction.
   * The BullMQ job is only added after commit (see enqueueAfterCommit) so the
   * worker never races an uncommitted row.
   */
  async enqueueMultimodalAnalysis(
    input: EnqueueAnalysisInput,
    q: Queryable,
  ): Promise<AnalysisJobRecord> {
    const payload: AnalysisJobPayload = {
      objectName: input.objectName,
      mediaKind: input.mediaKind,
      includeTranscript: input.includeTranscript,
      languageHint: input.languageHint ?? null,
    };
    return this.repo.insertPending(
      {
        kind: 'multimodal_feature_extraction',
        sessionId: input.sessionId,
        questionId: input.questionId,
        inviteId: input.inviteId,
        payload: payload as unknown as Record<string, unknown>,
      },
      q,
    );
  }

  /**
   * Enqueues a per-session recording (voice mode) for analysis, deduped by
   * object name. Returns null when a job already tracks this object.
   */
  async enqueueRecordingAnalysis(
    input: Omit<EnqueueAnalysisInput, 'questionId'>,
    q: Queryable,
  ): Promise<AnalysisJobRecord | null> {
    const existing = await this.repo.findBySessionAndObject(input.sessionId, input.objectName, q);
    if (existing) {
      return null;
    }
    return this.enqueueMultimodalAnalysis({ ...input, questionId: null }, q);
  }

  /** Adds the BullMQ job for a committed analysis_job row. */
  async enqueueAfterCommit(job: AnalysisJobRecord): Promise<void> {
    const payload = job.payload as unknown as AnalysisJobPayload;
    await this.queue.add({
      analysisJobId: job.id,
      kind: job.kind,
      sessionId: job.sessionId,
      questionId: job.questionId,
      inviteId: job.inviteId,
      objectName: payload.objectName,
      mediaKind: payload.mediaKind,
      includeTranscript: payload.includeTranscript,
      languageHint: payload.languageHint ?? undefined,
    });
  }

  async getSessionAnalysis(orgId: string, sessionId: string): Promise<SessionAnalysisResult> {
    await this.assertSessionInOrg(orgId, sessionId);
    const jobs = await this.repo.findBySession(sessionId);
    return { sessionId, jobs: jobs.map((job) => this.summarize(job)) };
  }

  /**
   * Returns the Level-3 aggregate feature JSON produced by the most recent
   * completed analysis job for a question. 404 when no completed job has
   * features yet.
   */
  async getQuestionFeatures(
    orgId: string,
    sessionId: string,
    questionId: string,
  ): Promise<QuestionFeaturesResult> {
    await this.assertSessionInOrg(orgId, sessionId);
    const jobs = await this.repo.findBySession(sessionId);
    const completed = jobs
      .filter(
        (job) =>
          job.questionId === questionId &&
          job.status === 'completed' &&
          job.result !== null &&
          job.result['features'] != null,
      )
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    const job = completed[0];
    if (!job) {
      throw new ApiException(
        404,
        'ANALYSIS_NOT_FOUND',
        'no completed analysis with features for this question',
      );
    }
    return {
      sessionId,
      questionId,
      analysisJobId: job.id,
      schemaVersion: job.schemaVersion,
      features: job.result?.['features'],
      media: job.result?.['media'] ?? null,
      completedAt: job.completedAt,
    };
  }

  /**
   * Tenant scoping mirrors the async-video review endpoints: the session's
   * invite must belong to the caller's org, otherwise 404 (no existence leak).
   */
  private async assertSessionInOrg(orgId: string, sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
    }
    const invite = await this.invites.findById(orgId, session.inviteId);
    if (!invite) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
    }
  }

  private summarize(job: AnalysisJobRecord): AnalysisJobSummary {
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      sessionId: job.sessionId,
      questionId: job.questionId,
      schemaVersion: job.schemaVersion,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      attempts: job.attempts,
      media: job.result?.['media'] ?? null,
      metrics: job.result?.['metrics'] ?? null,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type {
  InterviewSession,
  SessionTurnResponse,
  VoiceFallbackBody,
  VoiceFallbackResponse,
  VoiceTelemetryBody,
  VoiceTokenResponse,
} from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';
import { ApiException } from '@/common/errors';
import { TokenService } from '@/common/tokens';
import {
  AnalysisService,
  type AnalysisJobRecord,
  type AnalysisMediaKind,
} from '@/modules/analysis';
import { ConsentService } from '@/modules/consent';
import {
  INTERVIEWER_AI,
  type InterviewerAi,
  SessionsRepository,
  TranscriptRepository,
} from '@/modules/sessions';

/**
 * Recording notification the orchestrator attaches to the final voice
 * telemetry call after uploading the session recording to object storage
 * (Phase 14). Kept local because @zios/shared-types' VoiceTelemetryBody only
 * models the per-turn payload.
 */
export interface VoiceRecordingNotification {
  objectName?: string;
  storageRef?: string;
  uri?: string;
  /** Python orchestrator field naming ('video' for video-mode WebM captures). */
  media_kind?: string;
}

export type VoiceTelemetryPayload = VoiceTelemetryBody & {
  recording?: VoiceRecordingNotification;
  /** Top-level media kind sent alongside the recording notification. */
  media_kind?: string;
};

/** Extracts the storage object name from a telemetry recording ref. */
export function recordingObjectName(body: VoiceTelemetryPayload): string | null {
  const recording = body.recording;
  if (!recording) return null;
  const objectName = recording.objectName ?? recording.storageRef;
  return typeof objectName === 'string' && objectName.length > 0 ? objectName : null;
}

/**
 * Resolves the analysis media kind for a recording notification: video when
 * the payload says so or the object is a WebM container, audio otherwise.
 */
export function recordingMediaKind(body: VoiceTelemetryPayload): AnalysisMediaKind {
  const objectName = recordingObjectName(body);
  if (
    body.media_kind === 'video' ||
    body.recording?.media_kind === 'video' ||
    objectName?.endsWith('.webm')
  ) {
    return 'video';
  }
  return 'audio';
}

interface OrchestratorTokenPayload {
  sessionId: string;
  livekit: {
    url: string;
    token: string;
    roomName: string;
  };
  orchestrator: {
    wsUrl: string;
    token: string;
  };
}

@Injectable()
export class VoiceService {
  private readonly orchestratorBaseUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly sessions: SessionsRepository,
    private readonly transcript: TranscriptRepository,
    private readonly analysis: AnalysisService,
    private readonly consent: ConsentService,
    private readonly logger: PinoLogger,
    @Inject(INTERVIEWER_AI) private readonly conductor: InterviewerAi,
  ) {
    this.orchestratorBaseUrl = process.env.ORCHESTRATOR_URL ?? 'http://ai-orchestrator:8000';
    this.logger.setContext(VoiceService.name);
  }

  async issueToken(sessionId: string, recoveryToken: string): Promise<VoiceTokenResponse> {
    const session = await this.db.transaction(async (q) => {
      const row = await this.sessions.findById(sessionId, q);
      if (!row || row.recoveryTokenHash !== TokenService.hash(recoveryToken)) {
        throw new ApiException(401, 'RECOVERY_TOKEN_INVALID', 'recovery token is invalid');
      }
      // Video-mode interviews reuse this endpoint (the candidate web
      // VideoInterviewPage shares the voice token + orchestrator WS flow);
      // the mode is forwarded so the orchestrator can run video capture.
      if (row.mode !== 'voice' && row.mode !== 'video') {
        throw new ApiException(409, 'SESSION_MODE_INVALID', 'session is not a voice interview');
      }
      return row;
    });

    const response = await fetch(`${this.orchestratorBaseUrl}/voice/sessions/${sessionId}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryToken, mode: session.mode }),
    });
    if (!response.ok) {
      throw new ApiException(502, 'ORCHESTRATOR_ERROR', 'orchestrator failed to issue voice token');
    }
    const payload = (await response.json()) as OrchestratorTokenPayload;

    await this.db.transaction(async (q) => {
      await this.sessions.setLivekitRoomName(sessionId, payload.livekit.roomName, q);
    });

    const refreshed = (await this.sessions.findById(sessionId)) as InterviewSession;
    return {
      session: refreshed,
      livekit: payload.livekit,
      orchestrator: payload.orchestrator,
    };
  }

  async fallbackToText(
    sessionId: string,
    recoveryToken: string,
    _body: VoiceFallbackBody,
  ): Promise<VoiceFallbackResponse> {
    return this.db.transaction(async (q) => {
      const session = await this.loadAuthorizedSession(sessionId, recoveryToken, q);
      if (session.status !== 'live') {
        throw new ApiException(409, 'SESSION_STATE_INVALID', `session is ${session.status}`);
      }
      const updated = await this.sessions.setFallbackToText(sessionId, q);
      if (!updated) {
        throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
      }
      const snapshot = await this.loadSnapshot(session.kitVersionId, q);
      const transcript = await this.transcript.listBySession(sessionId, q);
      const lastRow = transcript[transcript.length - 1] ?? null;
      let turn: SessionTurnResponse;
      if (lastRow && lastRow.answerText === null) {
        const askedForQuestion = transcript.filter(
          (t) => t.questionId === lastRow.questionId,
        ).length;
        turn = {
          type: askedForQuestion > 1 ? 'followup' : 'question',
          text: lastRow.questionPrompt,
          questionId: lastRow.questionId,
        };
      } else {
        turn = await this.conductor.nextTurn({ session: updated, snapshot, transcript });
      }
      return { session: updated, turn };
    });
  }

  async recordTelemetry(
    sessionId: string,
    recoveryToken: string,
    body: VoiceTelemetryPayload,
  ): Promise<InterviewSession> {
    const { session, analysisJob } = await this.db.transaction(async (q) => {
      const session = await this.loadAuthorizedSession(sessionId, recoveryToken, q);
      await this.sessions.updateStatus(session.id, session.status, q, {
        preflightReport: {
          ...session.preflightReport,
          lastVoiceTelemetry: body.turn,
        },
      });

      // Phase 14: the orchestrator attaches the uploaded session recording to
      // the final telemetry call; enqueue multimodal analysis for it (audio
      // for voice WAVs, video for video-mode WebM captures).
      // Failure-isolated: analysis enqueue must never break telemetry ingest.
      let analysisJob: AnalysisJobRecord | null = null;
      const objectName = recordingObjectName(body);
      if (objectName) {
        try {
          const consentArtifact =
            (await this.consent.findBySessionId(sessionId, q)) ??
            (session.inviteId ? await this.consent.findByInviteId(session.inviteId, q) : null);
          if (consentArtifact && !consentArtifact.withdrawnAt) {
            analysisJob = await this.analysis.enqueueRecordingAnalysis(
              {
                sessionId,
                inviteId: session.inviteId,
                objectName,
                mediaKind: recordingMediaKind(body),
                includeTranscript: true,
              },
              q,
            );
          } else {
            this.logger.warn(
              { sessionId, objectName },
              'voice recording received without a consent artifact; analysis not enqueued',
            );
          }
        } catch (error) {
          this.logger.warn(
            { sessionId, objectName, err: error },
            'failed to enqueue voice recording analysis',
          );
        }
      }

      const refreshed = (await this.sessions.findById(sessionId, q)) as InterviewSession;
      return { session: refreshed, analysisJob };
    });

    // Enqueue the BullMQ job only after the telemetry transaction commits.
    if (analysisJob) {
      try {
        await this.analysis.enqueueAfterCommit(analysisJob);
      } catch (error) {
        this.logger.warn(
          { sessionId, analysisJobId: analysisJob.id, err: error },
          'failed to enqueue voice recording analysis job',
        );
      }
    }

    return session;
  }

  private async loadAuthorizedSession(
    sessionId: string,
    recoveryToken: string,
    q: Queryable,
  ): Promise<InterviewSession> {
    const session = await this.sessions.findById(sessionId, q);
    if (!session) {
      throw new ApiException(404, 'SESSION_NOT_FOUND', 'session not found');
    }
    if (session.recoveryTokenHash !== TokenService.hash(recoveryToken)) {
      throw new ApiException(401, 'RECOVERY_TOKEN_INVALID', 'recovery token is invalid');
    }
    return session;
  }

  private async loadSnapshot(kitVersionId: string, q: Queryable) {
    const { KitVersionsRepository } = await import('@/modules/kits');
    const versions = new KitVersionsRepository(this.db);
    const version = await versions.findById(kitVersionId, q);
    if (!version) {
      throw new ApiException(404, 'KIT_VERSION_NOT_FOUND', 'kit version not found');
    }
    return version.snapshot;
  }
}

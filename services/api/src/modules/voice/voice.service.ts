import { Inject, Injectable } from '@nestjs/common';
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
  INTERVIEWER_AI,
  type InterviewerAi,
  SessionsRepository,
  TranscriptRepository,
} from '@/modules/sessions';

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
    @Inject(INTERVIEWER_AI) private readonly conductor: InterviewerAi,
  ) {
    this.orchestratorBaseUrl = process.env.ORCHESTRATOR_URL ?? 'http://ai-orchestrator:8000';
  }

  async issueToken(sessionId: string, recoveryToken: string): Promise<VoiceTokenResponse> {
    await this.db.transaction(async (q) => {
      const row = await this.sessions.findById(sessionId, q);
      if (!row || row.recoveryTokenHash !== TokenService.hash(recoveryToken)) {
        throw new ApiException(401, 'RECOVERY_TOKEN_INVALID', 'recovery token is invalid');
      }
      if (row.mode !== 'voice') {
        throw new ApiException(409, 'SESSION_MODE_INVALID', 'session is not a voice interview');
      }
      return row;
    });

    const response = await fetch(`${this.orchestratorBaseUrl}/voice/sessions/${sessionId}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryToken }),
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
    body: VoiceTelemetryBody,
  ): Promise<InterviewSession> {
    return this.db.transaction(async (q) => {
      const session = await this.loadAuthorizedSession(sessionId, recoveryToken, q);
      await this.sessions.updateStatus(session.id, session.status, q, {
        preflightReport: {
          ...session.preflightReport,
          lastVoiceTelemetry: body.turn,
        },
      });
      return (await this.sessions.findById(sessionId, q)) as InterviewSession;
    });
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

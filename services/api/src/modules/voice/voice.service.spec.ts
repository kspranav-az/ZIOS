import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConsentService } from '@/modules/consent';
import type { DatabaseService, Queryable } from '@/modules/database';
import type { AnalysisService } from '@/modules/analysis';
import type { SessionsRepository, TranscriptRepository } from '@/modules/sessions';
import { TokenService } from '@/common/tokens';
import { VoiceService, type VoiceTelemetryPayload } from './voice.service';

interface MockDeps {
  sessions: {
    findById: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    setLivekitRoomName: ReturnType<typeof vi.fn>;
  };
  transcript: { listBySession: ReturnType<typeof vi.fn> };
  analysis: {
    enqueueRecordingAnalysis: ReturnType<typeof vi.fn>;
    enqueueAfterCommit: ReturnType<typeof vi.fn>;
  };
  consent: {
    findBySessionId: ReturnType<typeof vi.fn>;
    findByInviteId: ReturnType<typeof vi.fn>;
  };
}

function buildService() {
  const deps: MockDeps = {
    sessions: {
      findById: vi.fn(),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      setLivekitRoomName: vi.fn().mockResolvedValue(undefined),
    },
    transcript: { listBySession: vi.fn().mockResolvedValue([]) },
    analysis: {
      enqueueRecordingAnalysis: vi.fn().mockResolvedValue({ id: randomUUID() }),
      enqueueAfterCommit: vi.fn().mockResolvedValue(undefined),
    },
    consent: {
      findBySessionId: vi.fn().mockResolvedValue({ id: randomUUID(), withdrawnAt: null }),
      findByInviteId: vi.fn().mockResolvedValue(null),
    },
  };
  const db = {
    transaction: vi.fn(async (fn: (q: Queryable) => Promise<unknown>) => fn({} as Queryable)),
  } as unknown as DatabaseService;

  const service = new VoiceService(
    db,
    deps.sessions as unknown as SessionsRepository,
    deps.transcript as unknown as TranscriptRepository,
    deps.analysis as unknown as AnalysisService,
    deps.consent as unknown as ConsentService,
    { setContext: vi.fn(), warn: vi.fn() } as never,
    {} as never,
  );
  return { service, deps };
}

function fakeSession(sessionId: string, recoveryToken: string) {
  return {
    id: sessionId,
    recoveryTokenHash: TokenService.hash(recoveryToken),
    status: 'live',
    inviteId: randomUUID(),
    preflightReport: {},
  };
}

function telemetryBody(overrides: Partial<VoiceTelemetryPayload> = {}): VoiceTelemetryPayload {
  return {
    turn: {
      turnIndex: 1,
      vadMs: 1,
      sttFinalMs: 1,
      plannerMs: 1,
      ttsFirstAudioMs: 1,
      totalTurnMs: 1,
      transcript: 'hi',
      bargedIn: false,
      degradationRung: null,
    },
    ...overrides,
  } as VoiceTelemetryPayload;
}

describe('VoiceService.recordTelemetry recording media-kind routing (Phase 14)', () => {
  it('enqueues video analysis when the payload carries media_kind video', async () => {
    const { service, deps } = buildService();
    const sessionId = randomUUID();
    const recoveryToken = 'rt-' + randomUUID();
    deps.sessions.findById.mockResolvedValue(fakeSession(sessionId, recoveryToken));

    await service.recordTelemetry(
      sessionId,
      recoveryToken,
      telemetryBody({
        recording: { objectName: `recordings/${sessionId}/abc.webm` },
        media_kind: 'video',
      }),
    );

    expect(deps.analysis.enqueueRecordingAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        objectName: `recordings/${sessionId}/abc.webm`,
        mediaKind: 'video',
      }),
      expect.anything(),
    );
    expect(deps.analysis.enqueueAfterCommit).toHaveBeenCalled();
  });

  it('enqueues video analysis when the recording ref carries media_kind video', async () => {
    const { service, deps } = buildService();
    const sessionId = randomUUID();
    const recoveryToken = 'rt-' + randomUUID();
    deps.sessions.findById.mockResolvedValue(fakeSession(sessionId, recoveryToken));

    await service.recordTelemetry(
      sessionId,
      recoveryToken,
      telemetryBody({
        recording: {
          objectName: `recordings/${sessionId}/abc.webm`,
          media_kind: 'video',
        },
      }),
    );

    expect(deps.analysis.enqueueRecordingAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ mediaKind: 'video' }),
      expect.anything(),
    );
  });

  it('enqueues video analysis for .webm object names even without media_kind', async () => {
    const { service, deps } = buildService();
    const sessionId = randomUUID();
    const recoveryToken = 'rt-' + randomUUID();
    deps.sessions.findById.mockResolvedValue(fakeSession(sessionId, recoveryToken));

    await service.recordTelemetry(
      sessionId,
      recoveryToken,
      telemetryBody({ recording: { objectName: `recordings/${sessionId}/abc.webm` } }),
    );

    expect(deps.analysis.enqueueRecordingAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ mediaKind: 'video' }),
      expect.anything(),
    );
  });

  it('keeps audio as the default media kind for wav recordings', async () => {
    const { service, deps } = buildService();
    const sessionId = randomUUID();
    const recoveryToken = 'rt-' + randomUUID();
    deps.sessions.findById.mockResolvedValue(fakeSession(sessionId, recoveryToken));

    await service.recordTelemetry(
      sessionId,
      recoveryToken,
      telemetryBody({ recording: { objectName: `recordings/${sessionId}/abc.wav` } }),
    );

    expect(deps.analysis.enqueueRecordingAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ mediaKind: 'audio' }),
      expect.anything(),
    );
  });

  it('does not enqueue analysis without a consent artifact', async () => {
    const { service, deps } = buildService();
    const sessionId = randomUUID();
    const recoveryToken = 'rt-' + randomUUID();
    deps.sessions.findById.mockResolvedValue(fakeSession(sessionId, recoveryToken));
    deps.consent.findBySessionId.mockResolvedValue(null);

    await service.recordTelemetry(
      sessionId,
      recoveryToken,
      telemetryBody({
        recording: { objectName: `recordings/${sessionId}/abc.webm` },
        media_kind: 'video',
      }),
    );

    expect(deps.analysis.enqueueRecordingAnalysis).not.toHaveBeenCalled();
    expect(deps.analysis.enqueueAfterCommit).not.toHaveBeenCalled();
  });

  it('skips the queue push when the job was deduped (null record)', async () => {
    const { service, deps } = buildService();
    const sessionId = randomUUID();
    const recoveryToken = 'rt-' + randomUUID();
    deps.sessions.findById.mockResolvedValue(fakeSession(sessionId, recoveryToken));
    deps.analysis.enqueueRecordingAnalysis.mockResolvedValue(null);

    await service.recordTelemetry(
      sessionId,
      recoveryToken,
      telemetryBody({ recording: { objectName: `recordings/${sessionId}/abc.webm` } }),
    );

    expect(deps.analysis.enqueueAfterCommit).not.toHaveBeenCalled();
  });

  it('does nothing when the payload carries no recording ref', async () => {
    const { service, deps } = buildService();
    const sessionId = randomUUID();
    const recoveryToken = 'rt-' + randomUUID();
    deps.sessions.findById.mockResolvedValue(fakeSession(sessionId, recoveryToken));

    await service.recordTelemetry(sessionId, recoveryToken, telemetryBody());

    expect(deps.analysis.enqueueRecordingAnalysis).not.toHaveBeenCalled();
  });
});

describe('VoiceService.issueToken mode handling', () => {
  it('accepts video-mode sessions and forwards the mode to the orchestrator', async () => {
    const { service, deps } = buildService();
    const sessionId = randomUUID();
    const recoveryToken = 'rt-' + randomUUID();
    const session = { ...fakeSession(sessionId, recoveryToken), mode: 'video' };
    deps.sessions.findById.mockResolvedValue(session);
    deps.sessions.setLivekitRoomName = vi.fn().mockResolvedValue(undefined);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionId,
          livekit: { url: 'ws://livekit', token: 't', roomName: `voice-${sessionId}` },
          orchestrator: { wsUrl: `/voice/sessions/${sessionId}/stream`, token: 'orch' },
        }),
        { status: 200 },
      ),
    );
    let requestBody: string | undefined;
    try {
      await service.issueToken(sessionId, recoveryToken);
      requestBody = fetchSpy.mock.calls[0]?.[1]?.body as string;
    } finally {
      fetchSpy.mockRestore();
    }

    const body = JSON.parse(requestBody ?? '{}') as {
      mode?: string;
    };
    expect(body.mode).toBe('video');
  });
});

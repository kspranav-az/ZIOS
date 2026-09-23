import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PracticeTurnAudioBody, PracticeTurnAudioResponse } from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { StorageClient } from '@/modules/storage';
import { PracticeService } from './practice.service';

/** Audio MIME types the turn-audio endpoint accepts (browser MediaRecorder outputs). */
const ALLOWED_CONTENT_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
]);

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Voice-practice audio turns (Phase 12b): the record → transcribe → submit
 * bridge. The browser records an answer, this service stores it in MinIO and
 * asks the orchestrator to transcribe (the same /video/transcribe pipeline the
 * async-video mode uses — ffmpeg audio extraction is content-sniffed, so an
 * audio-only container works). The client then submits the returned transcript
 * through the normal text turn endpoint, optionally carrying the recording
 * object name for replay.
 *
 * Deliberately NOT a real-time room: the practice engine stays a synchronous
 * text-turn state machine (see phases/phase-12b-voice-practice-pdf.md).
 */
@Injectable()
export class PracticeAudioService {
  constructor(
    private readonly practice: PracticeService,
    private readonly storage: StorageClient,
  ) {}

  private orchestratorBaseUrl(): string {
    // Read lazily so tests can set ORCHESTRATOR_URL after the module is built.
    return process.env.ORCHESTRATOR_URL ?? 'http://ai-orchestrator:8000';
  }

  async transcribeTurn(
    accountId: string,
    sessionId: string,
    rawRecoveryToken: string,
    body?: PracticeTurnAudioBody,
  ): Promise<PracticeTurnAudioResponse> {
    // Ownership + live-state gate before we touch storage (404/409, no leaks).
    await this.practice.loadLiveSession(accountId, sessionId, rawRecoveryToken);

    // MediaRecorder reports "audio/webm;codecs=opus" — match on the bare MIME type.
    const rawContentType = body?.contentType ?? 'audio/webm';
    const contentType = (rawContentType.split(';')[0] ?? rawContentType).trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new ApiException(400, 'VALIDATION_ERROR', `unsupported contentType "${contentType}"`);
    }
    if (typeof body?.audioBase64 !== 'string' || body.audioBase64.length === 0) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'audioBase64 is required');
    }
    // Strict base64: Buffer.from silently drops invalid characters, which
    // would let garbage through to storage.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.audioBase64) || body.audioBase64.length % 4 !== 0) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'audioBase64 is not valid base64');
    }
    const audio = Buffer.from(body.audioBase64, 'base64');
    if (audio.length === 0) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'audioBase64 decodes to zero bytes');
    }
    if (audio.length > MAX_AUDIO_BYTES) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'audio exceeds the 25 MB limit');
    }

    // uploadRecording suffixes .webm and tags video/webm — cosmetic only; the
    // orchestrator sniffs bytes with ffmpeg, and the checksum keeps the key unique.
    const uploaded = await this.storage.uploadRecording(
      `practice-recordings/${sessionId}/${randomUUID()}`,
      audio,
    );
    const plainName = `${`practice-recordings/${sessionId}`}/${uploaded.checksum}.webm`;

    const params = new URLSearchParams({ object_name: plainName });
    let response: Response;
    try {
      response = await fetch(`${this.orchestratorBaseUrl()}/video/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch (cause) {
      throw new ApiException(
        502,
        'TRANSCRIPTION_FAILED',
        `could not reach the transcription service: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (!response.ok) {
      const text = await response.text();
      throw new ApiException(502, 'TRANSCRIPTION_FAILED', `transcription failed: ${text.slice(0, 200)}`);
    }
    const payload = (await response.json()) as { transcript?: string };
    return { transcript: payload.transcript ?? '', objectName: plainName };
  }
}

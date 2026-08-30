import { Injectable } from '@nestjs/common';
import { ApiException } from '@/common/errors';

/**
 * Thin client for the AI orchestrator's video transcription endpoint.
 *
 * The orchestrator now owns the full pipeline: download the stored video,
 * extract audio with ffmpeg, and route the audio through the mock (or real)
 * STT port. The API only needs to provide the object name.
 */
@Injectable()
export class AsyncVideoTranscriptionService {
  private orchestratorBaseUrl(): string {
    // Read lazily so tests can set ORCHESTRATOR_URL after the module is built.
    return process.env.ORCHESTRATOR_URL ?? 'http://ai-orchestrator:8000';
  }

  /**
   * Ask the orchestrator to transcribe the video stored at `objectName`.
   *
   * @param objectName Storage object name for the uploaded video.
   */
  async transcribe(objectName: string): Promise<string> {
    const params = new URLSearchParams();
    params.append('object_name', objectName);

    const response = await fetch(`${this.orchestratorBaseUrl()}/video/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiException(
        502,
        'TRANSCRIPTION_FAILED',
        `orchestrator failed to transcribe video: ${text}`,
      );
    }

    const payload = (await response.json()) as { transcript?: string };
    return payload.transcript ?? '';
  }
}

import { Injectable } from '@nestjs/common';
import { ApiException } from '@/common/errors';

/**
 * Thin client for the AI orchestrator's video transcription endpoint.
 *
 * In mock mode the orchestrator returns deterministic placeholder text so the
 * whole flow can be exercised without real STT credentials.
 */
@Injectable()
export class AsyncVideoTranscriptionService {
  private readonly orchestratorBaseUrl: string;

  constructor() {
    this.orchestratorBaseUrl = process.env.ORCHESTRATOR_URL ?? 'http://ai-orchestrator:8000';
  }

  /**
   * Sends a video buffer to the orchestrator and returns the transcript text.
   *
   * @param objectName Storage object name (passed to the orchestrator for logging).
   * @param videoBuffer Raw video bytes (webm/mp4).
   */
  async transcribe(objectName: string, videoBuffer: Buffer): Promise<string> {
    const form = new FormData();
    form.append('object_name', objectName);
    form.append('video', new Blob([videoBuffer], { type: 'video/webm' }), 'answer.webm');

    const response = await fetch(`${this.orchestratorBaseUrl}/video/transcribe`, {
      method: 'POST',
      body: form,
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

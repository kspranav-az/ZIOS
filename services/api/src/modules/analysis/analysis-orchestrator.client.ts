import { Injectable } from '@nestjs/common';

/**
 * Request/response contract for the AI orchestrator's multimodal analysis
 * endpoint (`POST {ORCHESTRATOR_URL}/analysis/video`). The orchestrator
 * downloads the stored media, preprocesses it with ffmpeg, runs the visual /
 * audio / transcript extractors, and returns Level-3 aggregate features
 * inline (large per-level artifacts live in MinIO under `analysis/...`).
 */
export interface AnalysisRequest {
  analysis_job_id: string;
  session_id: string;
  question_id: string | null;
  object_name: string;
  media_kind: 'video' | 'audio';
  include_transcript: boolean;
  language_hint: string | null;
  consent_verified: boolean;
}

export interface AnalysisMediaMetadata {
  duration_sec?: number;
  fps?: number;
  width?: number;
  height?: number;
  video_codec?: string;
  audio_sample_rate?: number;
  audio_channels?: number;
}

export interface AnalysisMetrics {
  duration_ms?: number;
  frames_processed?: number;
  audio_duration_sec?: number;
  features_generated?: number;
}

export interface AnalysisResponse {
  status: 'completed';
  analysis_job_id: string;
  schema_version: string;
  result?: {
    object_prefix?: string;
    objects?: Record<string, string>;
  };
  transcript_text?: string | null;
  features?: Record<string, unknown> | null;
  media?: AnalysisMediaMetadata;
  metrics?: AnalysisMetrics;
}

/** Typed failure from the orchestrator (or the transport to it). */
export class AnalysisOrchestratorError extends Error {
  constructor(
    /** HTTP status, or null when no response was received. */
    readonly status: number | null,
    readonly errorCode: string,
    readonly errorMessage: string,
  ) {
    super(errorMessage);
    this.name = 'AnalysisOrchestratorError';
  }
}

const DEFAULT_TIMEOUT_MS = 600_000;

@Injectable()
export class AnalysisOrchestratorClient {
  private orchestratorBaseUrl(): string {
    // Read lazily so tests can set ORCHESTRATOR_URL after the module is built.
    return process.env.ORCHESTRATOR_URL ?? 'http://ai-orchestrator:8000';
  }

  private timeoutMs(): number {
    const raw = Number(process.env.ANALYSIS_HTTP_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.orchestratorBaseUrl()}/analysis/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new AnalysisOrchestratorError(
          null,
          'ORCHESTRATOR_TIMEOUT',
          `orchestrator analysis timed out after ${this.timeoutMs()}ms`,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AnalysisOrchestratorError(
        null,
        'ORCHESTRATOR_UNREACHABLE',
        `orchestrator analysis request failed: ${message}`,
      );
    }

    if (!response.ok) {
      const text = await response.text();
      let errorCode = `HTTP_${response.status}`;
      let errorMessage = text || `orchestrator analysis failed with status ${response.status}`;
      try {
        const body = JSON.parse(text) as { error_code?: string; error_message?: string };
        if (typeof body.error_code === 'string' && body.error_code) {
          errorCode = body.error_code;
        }
        if (typeof body.error_message === 'string' && body.error_message) {
          errorMessage = body.error_message;
        }
      } catch {
        // Non-JSON error body: keep the raw text as the message.
      }
      throw new AnalysisOrchestratorError(response.status, errorCode, errorMessage);
    }

    return (await response.json()) as AnalysisResponse;
  }
}

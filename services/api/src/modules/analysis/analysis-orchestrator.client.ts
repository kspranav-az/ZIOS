import http from 'node:http';
import https from 'node:https';
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
    const { status, body } = await this.postJson(
      `${this.orchestratorBaseUrl()}/analysis/video`,
      request,
    );

    if (status < 200 || status >= 300) {
      let errorCode = `HTTP_${status}`;
      let errorMessage = body || `orchestrator analysis failed with status ${status}`;
      try {
        const parsed = JSON.parse(body) as { error_code?: string; error_message?: string };
        if (typeof parsed.error_code === 'string' && parsed.error_code) {
          errorCode = parsed.error_code;
        }
        if (typeof parsed.error_message === 'string' && parsed.error_message) {
          errorMessage = parsed.error_message;
        }
      } catch {
        // Non-JSON error body: keep the raw text as the message.
      }
      throw new AnalysisOrchestratorError(status, errorCode, errorMessage);
    }

    return JSON.parse(body) as AnalysisResponse;
  }

  /**
   * POST JSON via node:http/https rather than global fetch: undici's default
   * headersTimeout (300s) silently aborts long-running analysis requests well
   * before ANALYSIS_HTTP_TIMEOUT_MS, which legitimately runs to many minutes
   * for long videos on CPU-only hardware.
   */
  private postJson(
    url: string,
    payload: AnalysisRequest,
  ): Promise<{ status: number; body: string }> {
    const timeoutMs = this.timeoutMs();
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const transport = target.protocol === 'https:' ? https : http;
      const body = JSON.stringify(payload);
      const req = transport.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
          );
          res.on('error', reject);
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(
          new AnalysisOrchestratorError(
            null,
            'ORCHESTRATOR_TIMEOUT',
            `orchestrator analysis timed out after ${timeoutMs}ms`,
          ),
        );
      });
      req.on('error', (error) => {
        if (error instanceof AnalysisOrchestratorError) {
          reject(error);
          return;
        }
        reject(
          new AnalysisOrchestratorError(
            null,
            'ORCHESTRATOR_UNREACHABLE',
            `orchestrator analysis request failed: ${error.message}`,
          ),
        );
      });
      req.end(body);
    });
  }
}

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalysisOrchestratorClient,
  AnalysisOrchestratorError,
  type AnalysisRequest,
} from './analysis-orchestrator.client';

function sampleRequest(): AnalysisRequest {
  return {
    analysis_job_id: randomUUID(),
    session_id: randomUUID(),
    question_id: randomUUID(),
    object_name: 'async-video/s/q/hash.webm',
    media_kind: 'video',
    include_transcript: true,
    language_hint: null,
    consent_verified: true,
  };
}

function successBody(request: AnalysisRequest) {
  return {
    status: 'completed',
    analysis_job_id: request.analysis_job_id,
    schema_version: '1.0.0',
    result: {
      object_prefix: 'analysis/s/q',
      objects: { aggregated_features: 'analysis/s/q/aggregated_features.json' },
    },
    transcript_text: 'a full transcript',
    features: { speech: { wpm: { value: 132, valid: true } } },
    media: { duration_sec: 45, fps: 5, audio_sample_rate: 16000 },
    metrics: { duration_ms: 4200, frames_processed: 225 },
  };
}

describe('AnalysisOrchestratorClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ORCHESTRATOR_URL;
    delete process.env.ANALYSIS_HTTP_TIMEOUT_MS;
  });

  it('parses the contract 200 payload', async () => {
    process.env.ORCHESTRATOR_URL = 'http://orchestrator.test';
    const request = sampleRequest();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successBody(request)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new AnalysisOrchestratorClient();
    const response = await client.analyze(request);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://orchestrator.test/analysis/video');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(request);
    expect(response.schema_version).toBe('1.0.0');
    expect(response.transcript_text).toBe('a full transcript');
    expect(response.features).toEqual({ speech: { wpm: { value: 132, valid: true } } });
  });

  it('maps a 4xx/5xx with an error body to a typed error with parsed codes', async () => {
    process.env.ORCHESTRATOR_URL = 'http://orchestrator.test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error_code: 'MEDIA_CORRUPT', error_message: 'bad media' }), {
          status: 422,
        }),
      ),
    );

    const client = new AnalysisOrchestratorClient();
    const error = await client.analyze(sampleRequest()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AnalysisOrchestratorError);
    const typed = error as AnalysisOrchestratorError;
    expect(typed.status).toBe(422);
    expect(typed.errorCode).toBe('MEDIA_CORRUPT');
    expect(typed.errorMessage).toBe('bad media');
  });

  it('falls back to HTTP_<status> when the error body is not JSON', async () => {
    process.env.ORCHESTRATOR_URL = 'http://orchestrator.test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })));

    const client = new AnalysisOrchestratorClient();
    const error = await client.analyze(sampleRequest()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AnalysisOrchestratorError);
    const typed = error as AnalysisOrchestratorError;
    expect(typed.status).toBe(502);
    expect(typed.errorCode).toBe('HTTP_502');
    expect(typed.errorMessage).toBe('bad gateway');
  });

  it('maps a timeout abort to ORCHESTRATOR_TIMEOUT', async () => {
    process.env.ORCHESTRATOR_URL = 'http://orchestrator.test';
    process.env.ANALYSIS_HTTP_TIMEOUT_MS = '50';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('signal timed out', 'TimeoutError')),
    );

    const client = new AnalysisOrchestratorClient();
    const error = await client.analyze(sampleRequest()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AnalysisOrchestratorError);
    const typed = error as AnalysisOrchestratorError;
    expect(typed.status).toBeNull();
    expect(typed.errorCode).toBe('ORCHESTRATOR_TIMEOUT');
  });

  it('maps a connection failure to ORCHESTRATOR_UNREACHABLE', async () => {
    process.env.ORCHESTRATOR_URL = 'http://orchestrator.test';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));

    const client = new AnalysisOrchestratorClient();
    const error = await client.analyze(sampleRequest()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AnalysisOrchestratorError);
    const typed = error as AnalysisOrchestratorError;
    expect(typed.errorCode).toBe('ORCHESTRATOR_UNREACHABLE');
  });
});

import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
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

type Handler = (req: { method?: string; url?: string; body: string }) => {
  status: number;
  body: string;
  delayMs?: number;
};

/**
 * The client uses node:http directly (not global fetch) so long analysis
 * requests are not killed by undici's 300s headersTimeout; tests therefore
 * run against a real loopback server.
 */
async function withServer(
  handler: Handler,
  run: (baseUrl: string) => Promise<void>,
  captured?: { requests: { method?: string; url?: string; body: string }[] },
): Promise<void> {
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      captured?.requests.push({ method: req.method, url: req.url, body: raw });
      const out = handler({ method: req.method, url: req.url, body: raw });
      const respond = () => {
        // The client may have already destroyed the socket (timeout test).
        res.on('error', () => {});
        res.writeHead(out.status, { 'content-type': 'application/json' });
        res.end(out.body);
      };
      if (out.delayMs) {
        setTimeout(respond, out.delayMs);
      } else {
        respond();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('AnalysisOrchestratorClient', () => {
  afterEach(() => {
    delete process.env.ORCHESTRATOR_URL;
    delete process.env.ANALYSIS_HTTP_TIMEOUT_MS;
  });

  it('parses the contract 200 payload', async () => {
    const request = sampleRequest();
    const captured: { requests: { method?: string; url?: string; body: string }[] } = {
      requests: [],
    };
    await withServer(
      () => ({ status: 200, body: JSON.stringify(successBody(request)) }),
      async (baseUrl) => {
        process.env.ORCHESTRATOR_URL = baseUrl;
        const client = new AnalysisOrchestratorClient();
        const response = await client.analyze(request);
        expect(response.schema_version).toBe('1.0.0');
        expect(response.transcript_text).toBe('a full transcript');
        expect(response.features).toEqual({ speech: { wpm: { value: 132, valid: true } } });
      },
      captured,
    );
    expect(captured.requests).toHaveLength(1);
    expect(captured.requests[0]?.method).toBe('POST');
    expect(captured.requests[0]?.url).toBe('/analysis/video');
    expect(JSON.parse(captured.requests[0]?.body ?? '')).toEqual(request);
  });

  it('maps a 4xx/5xx with an error body to a typed error with parsed codes', async () => {
    await withServer(
      () => ({
        status: 422,
        body: JSON.stringify({ error_code: 'MEDIA_CORRUPT', error_message: 'bad media' }),
      }),
      async (baseUrl) => {
        process.env.ORCHESTRATOR_URL = baseUrl;
        const client = new AnalysisOrchestratorClient();
        const error = await client.analyze(sampleRequest()).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AnalysisOrchestratorError);
        const typed = error as AnalysisOrchestratorError;
        expect(typed.status).toBe(422);
        expect(typed.errorCode).toBe('MEDIA_CORRUPT');
        expect(typed.errorMessage).toBe('bad media');
      },
    );
  });

  it('falls back to HTTP_<status> when the error body is not JSON', async () => {
    await withServer(
      () => ({ status: 502, body: 'bad gateway' }),
      async (baseUrl) => {
        process.env.ORCHESTRATOR_URL = baseUrl;
        const client = new AnalysisOrchestratorClient();
        const error = await client.analyze(sampleRequest()).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AnalysisOrchestratorError);
        const typed = error as AnalysisOrchestratorError;
        expect(typed.status).toBe(502);
        expect(typed.errorCode).toBe('HTTP_502');
        expect(typed.errorMessage).toBe('bad gateway');
      },
    );
  });

  it('maps a slow response past ANALYSIS_HTTP_TIMEOUT_MS to ORCHESTRATOR_TIMEOUT', async () => {
    await withServer(
      () => ({ status: 200, body: '{}', delayMs: 500 }),
      async (baseUrl) => {
        process.env.ORCHESTRATOR_URL = baseUrl;
        process.env.ANALYSIS_HTTP_TIMEOUT_MS = '100';
        const client = new AnalysisOrchestratorClient();
        const error = await client.analyze(sampleRequest()).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AnalysisOrchestratorError);
        const typed = error as AnalysisOrchestratorError;
        expect(typed.status).toBeNull();
        expect(typed.errorCode).toBe('ORCHESTRATOR_TIMEOUT');
      },
    );
  });

  it('maps a connection failure to ORCHESTRATOR_UNREACHABLE', async () => {
    // Bind and immediately close a server to obtain a port that refuses.
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    process.env.ORCHESTRATOR_URL = `http://127.0.0.1:${port}`;
    const client = new AnalysisOrchestratorClient();
    const error = await client.analyze(sampleRequest()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnalysisOrchestratorError);
    const typed = error as AnalysisOrchestratorError;
    expect(typed.status).toBeNull();
    expect(typed.errorCode).toBe('ORCHESTRATOR_UNREACHABLE');
  });
});

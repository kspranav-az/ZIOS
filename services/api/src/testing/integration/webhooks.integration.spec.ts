import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ConsentByTokenResponse,
  CreateCandidateInviteResponse,
  CreateQuestionBody,
  KitDetailResponse,
  PreflightResponse,
  TurnResponse,
} from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  makeTestNamespace,
  postJson,
  signup,
  type TestApp,
} from './helpers';
import { verifyWebhookSignature } from '@/modules/webhooks';
import { WebhooksRepository } from '@/modules/webhooks';

const ns = makeTestNamespace('webhooks.test');

interface SinkRequest {
  event: string | undefined;
  signature: string | undefined;
  rawBody: string;
}

type SinkMode = '200' | '500' | 'hang';

/** Hermetic subscriber: records requests, answers per injected mode. */
function startSink(): {
  server: Server;
  url: string;
  requests: SinkRequest[];
  setMode: (mode: SinkMode) => void;
} {
  const requests: SinkRequest[] = [];
  let mode: SinkMode = '200';
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        event: req.headers['x-zios-event'] as string | undefined,
        signature: req.headers['x-zios-signature'] as string | undefined,
        rawBody: Buffer.concat(chunks).toString('utf8'),
      });
      if (mode === '200') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      } else if (mode === '500') {
        res.writeHead(500);
        res.end('boom');
      }
      // 'hang': never respond; the worker aborts on its timeout.
    });
  });
  return {
    server,
    url: '',
    requests,
    setMode: (next) => {
      mode = next;
    },
  };
}

async function createPublishedKit(test: TestApp, token: string): Promise<string> {
  const create = await postJson(
    test.baseUrl,
    '/kits',
    { title: 'Webhook Kit', role: 'Engineer', level: 'Mid' },
    bearer(token),
  );
  expect(create.status).toBe(201);
  const kit = ((await create.json()) as KitDetailResponse).kit;

  const question: CreateQuestionBody = {
    type: 'open_ended',
    prompt: 'Tell us about a challenging project.',
    topic: 'Experience',
    timeLimitSec: 120,
    timeLimitType: 'soft',
    mandatory: true,
    followupPolicy: 'none',
    rubricLines: [{ id: randomUUID(), text: 'Clarity', weight: 1 }],
  };
  const add = await postJson(test.baseUrl, `/kits/${kit.id}/questions`, question, bearer(token));
  expect(add.status).toBe(201);
  const publish = await postJson(test.baseUrl, `/kits/${kit.id}/publish`, undefined, bearer(token));
  expect(publish.status).toBe(201);
  return ((await publish.json()) as { version: { id: string } }).version.id;
}

/** Employer invite → candidate completes the whole text interview. */
async function completeOneInterview(
  test: TestApp,
  token: string,
  kitId: string,
  tag: string,
): Promise<string> {
  const inviteRes = await postJson(
    test.baseUrl,
    '/invites',
    {
      kitVersionId: kitId,
      candidate: { name: `Webhook Candidate ${tag}`, email: ns.email(tag) },
    },
    bearer(token),
  );
  expect(inviteRes.status).toBe(201);
  const invite = (await inviteRes.json()) as CreateCandidateInviteResponse;

  const consentRes = await postJson(test.baseUrl, `/invites/by-token/${invite.token}/consent`, {
    name: `Webhook Candidate ${tag}`,
  });
  expect(consentRes.status).toBe(200);
  const { session, recoveryToken } = (await consentRes.json()) as ConsentByTokenResponse;

  const preflight = await postJson(
    test.baseUrl,
    `/sessions/${session.id}/preflight`,
    {},
    { 'x-recovery-token': recoveryToken },
  );
  expect(preflight.status).toBe(200);
  let turn = ((await preflight.json()) as PreflightResponse).turn;

  let i = 0;
  while (turn.type !== 'wrapup') {
    const turnRes = await postJson(
      test.baseUrl,
      `/sessions/${session.id}/turn`,
      {
        answer:
          'A thorough answer with concrete outcomes, metrics, and lessons learned from the project.',
      },
      { 'x-recovery-token': recoveryToken },
    );
    expect(turnRes.status).toBe(200);
    turn = ((await turnRes.json()) as TurnResponse).turn;
    i += 1;
    expect(i).toBeLessThan(12);
  }
  return session.id;
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('condition not met in time');
}

describe.runIf(INTEGRATION_AVAILABLE)('webhooks (FR-E13-4)', () => {
  let test: TestApp;
  let adminToken: string;
  let sink: ReturnType<typeof startSink>;
  let endpointId: string;
  let endpointSecret: string;
  let kitId: string;
  let lastSessionId = '';

  beforeAll(async () => {
    process.env.WEBHOOK_QUEUE_NAME = `webhook-test-${randomUUID()}`;
    process.env.WEBHOOK_BACKOFF_MS = '300,600,1200,2400,4800';
    process.env.WEBHOOK_TIMEOUT_MS = '800';
    sink = startSink();
    await new Promise<void>((resolve) => sink.server.listen(0, '127.0.0.1', resolve));
    const port = (sink.server.address() as AddressInfo).port;
    sink.url = `http://127.0.0.1:${port}/hook`;

    test = await bootApp();
    await ns.purge(test.db);
    const account = await signup(test.baseUrl, ns.email('admin'));
    adminToken = account.token;

    const created = await postJson(
      test.baseUrl,
      '/webhooks/endpoints',
      { url: sink.url, events: ['interview.completed', 'report.ready'] },
      bearer(adminToken),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      endpoint: { id: string };
      secret: string;
    };
    endpointId = body.endpoint.id;
    endpointSecret = body.secret;

    kitId = await createPublishedKit(test, adminToken);
  });

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
    await new Promise<void>((resolve) => sink.server.close(() => resolve()));
  });

  async function listDeliveries(status?: string) {
    const res = await fetch(
      `${test.baseUrl}/webhooks/deliveries${status ? `?status=${status}` : ''}`,
      { headers: bearer(adminToken) },
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { deliveries: Array<Record<string, unknown>> }).deliveries;
  }

  /** Deliveries created after `marker` (ISO) — suites accumulate rows, so
   *  assertions must never match stale rows from earlier tests. */
  async function newDeliveries(marker: string, status?: string) {
    return (await listDeliveries(status)).filter(
      (d) => (d.createdAt as string) > marker,
    );
  }

  it('delivers signed interview.completed and report.ready to the sink', async () => {
    const before = sink.requests.length;
    const sessionId = await completeOneInterview(test, adminToken, kitId, 'happy');
    lastSessionId = sessionId;

    await waitFor(async () => sink.requests.length >= before + 2);

    const completed = sink.requests[before];
    const ready = sink.requests[before + 1];
    expect(completed?.event).toBe('interview.completed');
    expect(ready?.event).toBe('report.ready');

    // Signature verifies against the shown-once secret (constant-time path).
    expect(
      verifyWebhookSignature(
        endpointSecret,
        completed?.rawBody ?? '',
        completed?.signature ?? '',
        Math.floor(Date.now() / 1000),
      ),
    ).toBe(true);

    // Envelope contract: { id, event, occurred_at, data, links }.
    const payload = JSON.parse(completed?.rawBody ?? '{}') as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ['data', 'event', 'id', 'links', 'occurred_at'].sort(),
    );
    const data = payload.data as { interview_id: string; session_id: string; candidate: unknown };
    expect(data.interview_id).toBe(sessionId);
    expect(data.session_id).toBe(sessionId);
    const links = payload.links as { interview: string; scorecard: string };
    expect(links.interview).toContain(`/v1/interviews/${sessionId}`);
    expect(links.scorecard).toContain(`/v1/interviews/${sessionId}/scorecard`);

    await waitFor(async () => (await listDeliveries('delivered')).length >= 2);
  }, 60_000);

  it('dedupes re-emitted session_events (unique journal constraint)', async () => {
    const repo = test.app.get(WebhooksRepository);
    let eventId = '';
    const first = await test.db.transaction(async (q) => {
      // Probe needs a real session_event row (FK) — journal one directly.
      const event = await q.query(
        `INSERT INTO session_event (session_id, type, payload) VALUES ($1, 'probe', '{}'::jsonb)
         RETURNING id`,
        [lastSessionId],
      );
      eventId = (event.rows[0] as { id: string }).id;
      return repo.insertDelivery(
        {
          endpointId,
          sessionEventId: eventId,
          event: 'interview.completed',
          payload: { probe: true },
        },
        q,
      );
    });
    expect(first).not.toBeNull();
    const second = await test.db.transaction(async (q) =>
      repo.insertDelivery(
        {
          endpointId,
          sessionEventId: eventId,
          event: 'interview.completed',
          payload: { probe: true },
        },
        q,
      ),
    );
    expect(second).toBeNull();
  });

  it('backs off on 500 then delivers when the sink recovers', async () => {
    sink.setMode('500');
    const before = sink.requests.length;
    const marker = new Date().toISOString();
    await completeOneInterview(test, adminToken, kitId, 'retry');

    await waitFor(async () => sink.requests.length > before);

    // Backoff recorded: attempts >= 1, next attempt pushed into the future.
    const afterFirst = await newDeliveries(marker);
    const delivery = afterFirst.find((d) => d.event === 'interview.completed');
    expect(delivery).toBeTruthy();
    expect(delivery?.attempts).toBeGreaterThanOrEqual(1);

    sink.setMode('200');
    await waitFor(
      async () =>
        (
          await newDeliveries(marker, 'delivered')
        ).some((d) => d.event === 'interview.completed' && (d.attempts as number) >= 2),
      20_000,
    );
  }, 60_000);

  it('records a timeout attempt when the sink hangs', async () => {
    sink.setMode('hang');
    const marker = new Date().toISOString();
    await completeOneInterview(test, adminToken, kitId, 'timeout');

    await waitFor(async () => {
      const deliveries = await newDeliveries(marker);
      return deliveries.some(
        (d) => d.event === 'interview.completed' && (d.attempts as number) >= 1,
      );
    });

    const timed = (await newDeliveries(marker)).find((d) => d.event === 'interview.completed');
    expect(String(timed?.lastError)).toMatch(/abort|timeout|unreachable/i);

    sink.setMode('200');
    await waitFor(async () =>
      (await newDeliveries(marker, 'delivered')).some((d) => d.event === 'interview.completed'),
    );
  }, 60_000);

  it('marks failed after 5 attempts; admin replay redelivers', async () => {
    sink.setMode('500');
    const marker = new Date().toISOString();
    await completeOneInterview(test, adminToken, kitId, 'exhaust');

    // Wait for exhaustion: 300+600+1200+2400+4800 backoff ≈ 9.3s plus attempts.
    let failedId: string | undefined;
    await waitFor(
      async () => {
        const failed = (await newDeliveries(marker, 'failed')).find(
          (d) => d.event === 'interview.completed',
        );
        failedId = failed?.id as string | undefined;
        return Boolean(failedId);
      },
      40_000,
    );

    sink.setMode('200');
    const replay = await postJson(
      test.baseUrl,
      `/webhooks/deliveries/${failedId}/replay`,
      undefined,
      bearer(adminToken),
    );
    expect(replay.status).toBe(200);

    await waitFor(
      async () =>
        (await listDeliveries('delivered')).some((d) => d.id === failedId),
      20_000,
    );
  }, 90_000);
});

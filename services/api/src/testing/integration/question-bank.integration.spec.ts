import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BankSearchResponse, KitResponse, QuestionResponse } from '@zios/shared-types';
import {
  INTEGRATION_AVAILABLE,
  bearer,
  bootApp,
  makeTestNamespace,
  signup,
  type TestApp,
} from './helpers';

const execFileAsync = promisify(execFile);
const ns = makeTestNamespace('e2e-bank.test');
const SEED_SCRIPT = path.resolve(__dirname, '../../../../../infra/migrations/seed.js');

function runSeed(): Promise<{ stdout: string }> {
  return execFileAsync('node', [SEED_SCRIPT], { env: process.env });
}

function search(baseUrl: string, token: string, params: string): Promise<Response> {
  return fetch(`${baseUrl}/bank/questions?${params}`, { headers: bearer(token) });
}

describe.skipIf(!INTEGRATION_AVAILABLE)('question bank (integration)', () => {
  let test: TestApp;
  let token: string;

  beforeAll(async () => {
    test = await bootApp();
    await ns.purge(test.db);
    // The bank is seeded global reference data; seeding is idempotent.
    await runSeed();
    const account = await signup(test.baseUrl, ns.email('bank-user'));
    token = account.token;
  }, 120000);

  afterAll(async () => {
    await ns.purge(test.db);
    await test.app.close();
  });

  it('holds ≥ 500 items across ≥ 10 families with all four types (FR-E4-1)', async () => {
    const stats = await test.db.query(
      `SELECT count(*)::int AS total,
              count(DISTINCT role_family)::int AS families,
              count(DISTINCT type)::int AS types
       FROM question_bank_item`,
    );
    const { total, families, types } = stats.rows[0] as {
      total: number;
      families: number;
      types: number;
    };
    expect(total).toBeGreaterThanOrEqual(500);
    expect(families).toBeGreaterThanOrEqual(10);
    expect(types).toBe(4);
    // Every item carries rubric lines with weights summing to 1.
    const badRubrics = await test.db.query(
      `SELECT count(*)::int AS n FROM question_bank_item
       WHERE jsonb_array_length(rubric_lines) < 2
          OR abs((
            SELECT sum((line->>'weight')::numeric)
            FROM jsonb_array_elements(rubric_lines) AS line
          ) - 1) > 0.01`,
    );
    expect((badRubrics.rows[0] as { n: number }).n).toBe(0);
  });

  it('is idempotent: a second seed run inserts nothing new', async () => {
    const before = await test.db.query('SELECT count(*)::int AS n FROM question_bank_item');
    const { stdout } = await runSeed();
    expect(stdout).toContain('0 inserted');
    const after = await test.db.query('SELECT count(*)::int AS n FROM question_bank_item');
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
  }, 60000);

  it('searches by free text (ILIKE) and filters', async () => {
    const textRes = await search(test.baseUrl, token, 'query=event%20loop');
    expect(textRes.status).toBe(200);
    const textBody = (await textRes.json()) as BankSearchResponse;
    expect(textBody.total).toBeGreaterThanOrEqual(1);
    expect(textBody.items[0]?.prompt.toLowerCase()).toContain('event loop');

    const familyRes = await search(test.baseUrl, token, 'role_family=sales');
    const familyBody = (await familyRes.json()) as BankSearchResponse;
    expect(familyBody.total).toBeGreaterThanOrEqual(30);
    expect(familyBody.items.every((item) => item.roleFamily === 'sales')).toBe(true);

    const typeRes = await search(test.baseUrl, token, 'type=rating_scale');
    const typeBody = (await typeRes.json()) as BankSearchResponse;
    expect(typeBody.items.length).toBeGreaterThan(0);
    expect(typeBody.items.every((item) => item.type === 'rating_scale')).toBe(true);
    expect(typeBody.items.every((item) => item.options === null)).toBe(true);

    const comboRes = await search(
      test.baseUrl,
      token,
      'role_family=engineering-backend&difficulty=hard&type=open_ended',
    );
    const comboBody = (await comboRes.json()) as BankSearchResponse;
    expect(comboBody.items.length).toBeGreaterThan(0);
    expect(
      comboBody.items.every(
        (item) =>
          item.roleFamily === 'engineering-backend' &&
          item.difficulty === 'hard' &&
          item.type === 'open_ended',
      ),
    ).toBe(true);

    const tagRes = await search(test.baseUrl, token, 'tag=behavioral');
    const tagBody = (await tagRes.json()) as BankSearchResponse;
    expect(tagBody.items.length).toBeGreaterThan(0);
    expect(tagBody.items.every((item) => item.tags.includes('behavioral'))).toBe(true);
  });

  it('paginates deterministically at 50 per page', async () => {
    const page1 = (await (await search(test.baseUrl, token, '')).json()) as BankSearchResponse;
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(50);
    expect(page1.items).toHaveLength(50);
    expect(page1.total).toBeGreaterThanOrEqual(500);
    expect(page1.totalPages).toBeGreaterThanOrEqual(10);

    const page2 = (await (
      await search(test.baseUrl, token, 'page=2')
    ).json()) as BankSearchResponse;
    expect(page2.items).toHaveLength(50);
    const page1Ids = new Set(page1.items.map((item) => item.id));
    expect(page2.items.some((item) => page1Ids.has(item.id))).toBe(false);
  });

  it('rejects invalid filter values with 400', async () => {
    const badType = await search(test.baseUrl, token, 'type=essay');
    expect(badType.status).toBe(400);
    expect(((await badType.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
    const badPage = await search(test.baseUrl, token, 'page=0');
    expect(badPage.status).toBe(400);
  });

  it('clones a bank item into a kit with provenance (FR-E4-1, FR-E4-3)', async () => {
    const { kit } = (await (
      await fetch(`${test.baseUrl}/kits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearer(token) },
        body: JSON.stringify({ title: 'Bank-backed kit', role: 'Backend', level: 'mid' }),
      })
    ).json()) as KitResponse;

    const picked = (await (
      await search(test.baseUrl, token, 'role_family=engineering-qa&type=mcq_single')
    ).json()) as BankSearchResponse;
    const item = picked.items[0];
    expect(item).toBeDefined();

    const cloneRes = await fetch(`${test.baseUrl}/kits/${kit.id}/questions/from-bank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer(token) },
      body: JSON.stringify({ bankItemId: item!.id, topic: 'QA fundamentals' }),
    });
    expect(cloneRes.status).toBe(201);
    const { question } = (await cloneRes.json()) as QuestionResponse;
    expect(question.source).toBe('bank');
    expect(question.sourceRef).toBe(item!.id);
    expect(question.prompt).toBe(item!.prompt);
    expect(question.topic).toBe('QA fundamentals');
    expect(question.options).toEqual(item!.options);
    expect(question.rubricLines).toEqual(item!.rubricLines);

    // Unknown bank item → 404 BANK_ITEM_NOT_FOUND
    const missing = await fetch(`${test.baseUrl}/kits/${kit.id}/questions/from-bank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer(token) },
      body: JSON.stringify({ bankItemId: crypto.randomUUID() }),
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe('BANK_ITEM_NOT_FOUND');
  });
});

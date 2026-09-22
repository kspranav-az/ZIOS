# Phase 10 Implementation Plan — Integration API, Webhooks, Credits Wallet + DLQ Redrive

**Companion to:** `phases/phase-10-integration-api-billing.md` (scope/exit gates) · **Created:** 2026-09-22
**Execution mode:** thinking LOW — this file is the spec. Follow it step by step; do not redesign.
**Pre-flight (once):** `docker compose up -d` and `pnpm migrate`. Postgres is on **55432** (root `.env` is stale — always use the 55432 URL inline).

Global rules (AGENTS.md): no direct commits to `main`; Conventional Commits with body; every branch ends with its tests green + phase-file checkboxes ticked + squash-… NO — owner ruled 2026-09-22: merge with `--no-ff`, never squash; `merge:` commits need `git commit --no-verify` (commitlint rejects the type). Feature code never names a vendor; integration tests must isolate queue names (per-boot UUID queues — copy the pattern from `db53ddb`). Never reference `org.updated_at` in credit queries (no such column).

Test commands:

- API: `DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos pnpm --filter @zios/api test`
- Lint/typecheck: `pnpm --filter @zios/api lint && pnpm --filter @zios/api typecheck`
- employer-web: `pnpm --filter employer-web test` · E2E: `pnpm --filter employer-web e2e`
- Orchestrator is NOT touched by Phase 10.

---

## Branch 0 — `phase-10/dlq-redrive` (1–2 days, do first — independent, small)

Closes the STATE.md gap "No DLQ redrive endpoint (both tables)". Today only `scripts/redrive-analysis-job.js` exists.

**Step 1 — Port the script logic into the analysis module.**

- `services/api/src/modules/analysis/analysis.repository.ts`: add `getDlqJob(jobId)`, `redriveFromDlq(jobId, q)` — move row from `analysis_job_dlq` back into `analysis_job` with `status='pending'`, `attempts=0`, clear error fields, delete DLQ row (same transaction).
- `services/api/src/modules/analysis/analysis.service.ts`: add `redrive(jobId)` — re-fetch job, re-enqueue BullMQ after commit (mirror the existing enqueue-after-commit pattern in this module).

**Step 2 — Transcription DLQ.** Same shape for `transcription_job` / `transcription_job_dlq` (find the owning module — async-video module; add repository + service methods + worker re-enqueue).

**Step 3 — Admin endpoints.** In each module's controller: `POST /analysis/dlq/:jobId/redrive` and `POST /async-video/dlq/:jobId/redrive` (match existing route prefixes — check controllers). Guard: Admin role only (copy guard from an existing admin-gated route, e.g. org admin endpoints). Return the re-enqueued job DTO; 404 when DLQ row absent.

**Step 4 — Tests.** Integration spec (new file, per-boot UUID queue isolation!):

- failing job → lands in DLQ → redrive endpoint → job returns to pending → worker completes it → row gone from DLQ.
- 404 for unknown id; 403 for non-admin; transcription DLQ covered likewise.

**Gate:** API suite green, lint/typecheck green. Tick the STATE.md gap row (mark "admin redrive endpoint added", remove from gaps).

---

## Branch 1 — `phase-10/api-keys-v1` (2–3 days)

**Step 1 — Migration `api-key` table** (new file in `infra/migrations/migrations/`, timestamp `Date.now()` style like siblings):

```
api_key: id uuid pk, org_id uuid fk→org, kind text check(kind in ('test','live')),
  key_hash text unique, prefix text, label text, scopes text[] default '{interviews:read,interviews:write}',
  rate_limit_per_min int default 120, created_by uuid fk→app_user,
  created_at timestamptz default now(), rotated_at timestamptz, revoked_at timestamptz
```

Index on (org_id, kind).

**Step 2 — Module `services/api/src/modules/integration-api/`.** Files: `api-keys.module.ts`, `api-keys.service.ts`, `api-keys.repository.ts`, `api-key-auth.guard.ts`, `keys.controller.ts` (org-admin UI-facing key CRUD), DTOs with class-validator.

- Key format: `zios_{kind}_` + 32 random bytes base64url. Store **sha256 hash only**; return full key ONCE at creation/rotation. `prefix` = first 12 chars for display.
- Auth guard (`ApiKeyGuard`): reads `Authorization: Bearer zios_live_...`, sha256 → lookup where `revoked_at is null` → attaches `{ orgId, keyId, kind, scopes }` to request. 401 `INVALID_API_KEY` on miss. Check `scopes` per route (`@Scopes('interviews:write')` decorator + metadata).

**Step 3 — Rate limiting.** Redis fixed-window INCR `ratelimit:{keyId}:{window}` with TTL 60s; limit from key row; 429 `RATE_LIMITED` with `Retry-After`. Hermetic: use the compose Redis in tests.

**Step 4 — Employer-web API Keys page** (`apps/employer-web/src/pages/ApiKeysPage.tsx` + route under Admin nav): list keys (prefix, kind, created, rotated, revoked), create (test|live), rotate (shows new key once, modal with copy), revoke. Existing design system only; `.tsx`, typed; no vendor names.

**Step 5 — Tests.** Unit: hash/lookup/rotate/revoke; guard 401/403-scope; rate-limit 429. Integration: full lifecycle via HTTP against compose stack. employer-web: page unit tests + extend an e2e if cheap.

**Gate:** green + tick FR-E13-1 checkbox (rotation + scoping + rate limits tested).

---

## Branch 2 — `phase-10/interviews-endpoints` (3–4 days)

**Step 1 — Migrations:**

- `candidate` table: add `external_ref text`; partial unique index on `(org_id, external_ref)` where not null.
- Idempotency: unique index on `invite (org_id, candidate_id, kit_version_id)` is NOT right (same candidate can re-interview). Instead unique on `(org_id, external_ref, kit_version_id)` — requires `external_ref` on `invite` too, or a dedicated table `external_interview (org_id, external_ref, kit_version_id, invite_id, unique(...))`. **Choose the dedicated table** — cleanest, no invite churn.

**Step 2 — `POST /v1/interviews`** in integration-api module (`interviews.controller.ts`, `v1-interviews.service.ts`):
Body (class-validator DTO): `{ kit_id? , jd_text?, candidate {name, email, phone?, external_ref}, mode ('text'|'voice'|'video'|'async_video'|'human'), proctoring_level?, callback_url?, send_invite: boolean }`.

- Validate: exactly one of `kit_id` / `jd_text`; mode supported.
- `kit_id` path: load kit + latest published version (reuse kits module service).
- `jd_text` path: reuse generation module to produce a kit (JD → proposal flow); persist generated kit bound to org. If generation needs LLM mock fixtures, ensure the v1 path has a fixture (mock fixture table throws on unknown tasks — add fixture if needed).
- Create candidate (with `external_ref`) + invite + (session on first open — mirror existing invite flow). **Idempotency:** `INSERT external_interview … ON CONFLICT (org_id, external_ref, kit_version_id) DO NOTHING` inside the create transaction; on conflict return the existing `{ interview_id, invite_link }` with 200 (not 201).
- Response: `{ interview_id, invite_link, status: 'invited' }`.
- Enforce credit block here (blocked-at-zero, Branch 4 completes the guard — for now call `credits.assertCanStart(orgId, mode)`; implement the assert in Branch 4 and stub-return here? NO — implement assert minimally in Branch 2 as balance>0 check; Branch 4 refines with pricing/grace). Simpler sequencing: **do the credit guard fully in Branch 4**, Branch 2 has no debit (async-video already debits on create via its own path).

**Step 3 — `GET /v1/interviews/{id}`** → `{ id, status, mode, candidate{external_ref}, created_at, completed_at? }`. Org-scoped (from API key). 404 cross-org.

**Step 4 — `GET /v1/interviews/{id}/scorecard`** → structured JSON from evaluation module: report + scores + evidence spans + integrity flags + overrides + `schema_version: 'v1'` + `recommendation`. Reuse the evaluation repository read path the web report uses (do NOT hand-build a second query — factor a shared read model if the web one isn't reusable). 404 until report exists; 409 `REPORT_NOT_READY` if session completed but report missing? Keep: 404 with code.

**Step 5 — Rate limiting + guard wiring:** all `/v1/*` behind `ApiKeyGuard` (global prefix `v1` set in module, separate from JWT app guard stack).

**Step 6 — Docs:** OpenAPI comes free from Nest decorators; add `@ApiTags('v1')`, descriptions, example payloads. Sandbox key pre-seeded by a script `scripts/seed-sandbox.js` (org + test key + sample kit) for FR-E13-5.

**Step 7 — Tests.** Integration spec `v1-interviews.integration.spec.ts` (UUID queue isolation):

- create from kit_id → invite_link resolves (hit the landing route).
- create from jd_text → kit generated, interview created.
- **idempotency:** same external_ref+kit posted twice → same interview_id, single invite row.
- 401 without key; 429 over limit; scope enforcement; cross-org 404.
- scorecard: complete a seeded session (reuse existing seeding patterns) → GET scorecard matches report contents + schema_version v1.
- E2E validation-loop spec (headless, no browser): script-style node test driving POST → poll status → scorecard, mirroring the webhook E2E in Branch 3.

**Gate:** green + tick FR-E13-2, FR-E13-3 checkboxes.

---

## Branch 3 — `phase-10/webhooks` (3–4 days)

**Step 1 — Migrations:**

```
webhook_endpoint: id uuid pk, org_id uuid fk→org, url text, secret text (min 32 chars, generated),
  events text[] check (⊆ {'interview.completed','report.ready'}), active bool default true,
  created_at, updated_at? (NO — remember org has none; this table MAY have its own updated_at, that's fine)
webhook_delivery: id uuid pk, endpoint_id fk, session_event_id bigint fk→session_event,   -- dedupe
  event text, payload jsonb, status text check(status in ('pending','delivered','failed')) default 'pending',
  attempts int default 0, next_attempt_at timestamptz default now(),
  last_response_code int, last_error text, delivered_at timestamptz, created_at
  unique(endpoint_id, session_event_id)
```

**Step 2 — Event source.** `sessions.service.ts` `emit()` already journals `session_event` in-transaction. Hook there (and in the evaluation module where the report is finalized): after the `session_event` insert, for each active endpoint subscribed to the mapped event (`session.completed` → `interview.completed`; report-finalized event → `report.ready`), insert `webhook_delivery` pending rows **in the same transaction**, collect delivery ids, and after commit enqueue BullMQ `webhook` jobs (copy the analysis module's durable-row-then-enqueue pattern exactly). Mapping lives in the webhook module — keep `sessions` dumb: sessions emits domain events; a `WebhookFanoutService.onDomainEvent(...)` is called from the emit sites. Keep call sites ≤ 2 (sessions emit + evaluation finalize).

**Step 3 — Delivery worker.** BullMQ processor `webhook-delivery` (in-process worker like analysis):

- Build payload: `{ id: delivery_id, event, occurred_at, data: { interview_id, org_external_ref… } }` — include `candidate.external_ref` (the validation-layer identity) and links `interview: /v1/interviews/{id}`, `scorecard: /v1/interviews/{id}/scorecard` (absolute API base from env `PUBLIC_API_BASE_URL`, default http://localhost:3000).
- Sign: header `X-Zios-Signature: t={unix},{v1=hmac_sha256(secret, "{t}.{rawBody}")}` and `X-Zios-Event: {event}`. Constant-time compare on replay.
- POST with 10s timeout. 2xx → delivered. else attempts++, backoff `1m,5m,30m,2h,12h` (compute `next_attempt_at`), re-enqueue delay; after 5 attempts → status `failed` (stays journaled — replayable, never deleted).
- **Replay tooling:** `POST /webhooks/deliveries/:id/replay` (Admin) resets attempts/next_attempt_at and re-enqueues; plus `GET /webhooks/deliveries?status=failed` list.

**Step 4 — Callback URL alternative.** FR-E13-2's per-request `callback_url`: on create, upsert an org webhook endpoint (events both, secret generated, active) — validates the URL (https except localhost). Document precedence (org-level endpoints also fire).

**Step 5 — Employer-web:** minimal Webhooks admin page: list endpoints (url, events, active), create/deactivate, delivery log view (status, attempts, last error) with replay button. Reuse table/components patterns.

**Step 6 — Tests.**

- Integration: `webhooks.integration.spec.ts` — seed endpoint with a **local HTTP sink** (spin an `node:http` server on an ephemeral port inside the test — hermetic, no external calls):
  - happy path: complete session → delivery row → sink receives POST → signature verifies (recompute HMAC in test) → status delivered.
  - failure injection: sink returns 500 → backoff re-scheduled (assert next_attempt_at + attempts), then sink flips to 200 → delivered.
  - exhaustion → failed; replay endpoint → delivered.
  - dedupe: re-emit same session_event → no duplicate delivery rows.
  - timeout injection: sink never responds → attempt recorded, retried.
- Contract: payload JSON schema snapshot test (versioned).

**Gate:** green + tick FR-E13-4 checkbox (99.5%-within-1-min claim = failure-injection evidence, note actual numbers in the checkbox comment).

---

## Branch 4 — `phase-10/credits-wallet` (3–4 days)

**Step 1 — Pricing config.** `credits/pricing.ts`: `{ text:1, voice:2, video:3, human:1, async_video:3 }` — **single source of truth**; async-video's hardcoded 3 moves here (refactor its debit call site, keep its refund-before-first-answer semantics unchanged).

**Step 2 — Debit on start, all modes.** Find each mode's session-start path (sessions.service start/transition to live, human slot start, async-video create already debits — switch it to pricing map). Debit via existing `credits.debit` (atomic, same tx as the start transition where feasible; otherwise immediately after with the ledger row as source of truth). Insufficient → `402 INSUFFICIENT_CREDITS` (existing mapping).

**Step 3 — Refund on system failure.** sessions module: define the terminal-failure transitions that emit a `session.system_failed` domain event (voice/video setup failure with orchestrator unreachable, infra error paths — enumerate the existing failure branches, keep it honest: only paths that are genuinely system faults, not candidate abandonment). Webhook-style handler (same durable pattern): credit refund with ledger entry `reason: system_failure_refund`. Reuse the 09b refund code path.

**Step 4 — Blocked-at-zero with grace.** `credits.assertCanStart(orgId, mode)`: balance ≥ price OR session already in-flight (check happens only at start transitions → in-flight sessions inherently unaffected). Call from every mode start + v1 create. Concurrency: single-writer `adjustCredits` already atomic; race of two simultaneous starts → one gets 402, ledger stays exact (add the race test).

**Step 5 — Low-balance alerts.** After each successful debit: if balance < org threshold (new column `low_balance_threshold int default 5` on org — org table changes are fine, it's our table) → enqueue email via notifications module (Mailpit in dev): template `low-balance-alert`. Also alert when crossing 0 (blocked). Digest: max 1 email/24h per org (watermark column or redis key `lowbal:{org}:{day}`).

**Step 6 — Admin grant tool.** `scripts/grant-credits.js <orgSlug> <amount> <reason>` — uses the credits service SQL directly (script pattern like siblings; needs the 55432 DATABASE_URL inline).

**Step 7 — Wallet UI (employer-web).** `WalletPage.tsx`: balance card, per-mode price table, ledger table (append-only, newest first, debits green/refunds), low-balance threshold editor, link to API keys page. Admin-gated route.

**Step 8 — Tests.**

- Unit: pricing map; assertCanStart math.
- Integration (`credits-wallet.integration.spec.ts`): debit each mode on start; refund on simulated system failure (force the failure branch — mirror how 09b simulated failures); blocked-at-zero blocks new start but an in-flight session still completes and isn't re-charged; parallel-debit race (Promise.all two starts, one 402, exact ledger chain `balance_after`); low-balance email lands in Mailpit (query Mailpit API like other tests do).
- employer-web unit tests for WalletPage; extend e2e admin flow if cheap.

**Gate:** green + tick FR-E14-1, FR-E14-2, FR-E14-3 checkboxes.

---

## Final integration & close-out (1 day, on `phase-10/final-validation`)

1. Full API suite + both web suites + all E2E green on a compose stack from scratch (`docker compose down -v && up -d --build`, `pnpm migrate`).
2. Runbook: `docs/` short runbook for the partner (validation-layer loop) + turnaround metric query (P95 API-created→report.ready from `webhook_delivery.delivered_at - external_interview.created_at`).
3. Sandbox validation of FR-E13-5: fresh test key → `scripts/seed-sandbox.js` → docs page → **you** (or a stand-in) run the loop from curl only. Record outcome in the Validation section.
4. Update `docs/STATE.md` (E13 ✅, E14 ✅, gaps table) + `CONTEXT.md` handover + tick all Phase-10 phase-file checkboxes with evidence.
5. Tag `phase-10-complete` after owner sign-off. Milestone tag `v0.2.0-pilot` comes after Phase 11, not now.

## Estimated totals

| Branch           | Days | Main risk                               |
| ---------------- | ---- | --------------------------------------- |
| 0 dlq-redrive    | 1–2  | low — script logic exists               |
| 1 api-keys       | 2–3  | rate-limit hermetic testing             |
| 2 interviews     | 3–4  | jd_text path reusing generation flow    |
| 3 webhooks       | 3–4  | backoff timing tests (keep fake timers) |
| 4 credits-wallet | 3–4  | debit/refund wiring across 5 modes      |
| final            | 1    | sandbox run needs a human               |

**~13–18 working days** sequential; branches 1 and 0 could parallelize but sequential keeps CI calm.

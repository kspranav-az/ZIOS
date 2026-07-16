# Phase 10 — Integration API, Webhooks & Credits Wallet

**Status:** ⬜ Not started · **Depends on:** Phase 09 (or Phase 08 if 09 was cut) · **PRD refs:** E13 (FR-E13-1…E13-5), E14 (FR-E14-1…E14-3), §15 W9

## Objective

Close the **validation-layer loop** for the existing product: it pushes a candidate + JD over API and receives a structured scorecard webhook — plus the prepaid credits wallet that makes usage billable.

## Scope

**In**
- Org API keys (test/live), scoped, rotatable, rate-limited; key auth on all `/v1` routes (FR-E13-1)
- `POST /v1/interviews` — `{ kit_id | jd_text, candidate {name, email, phone, external_ref}, mode, proctoring_level, callback_url, send_invite }` → `{ interview_id, invite_link }`; idempotent on `external_ref + kit` (FR-E13-2)
- `GET /v1/interviews/{id}` (status) and `GET /v1/interviews/{id}/scorecard` — full structured JSON: scores, evidence, flags, recommendation, versions; versioned schema matching the web report (FR-E13-3)
- Webhooks: `interview.completed`, `report.ready`; HMAC-signed, retried with backoff, replayable; delivery log (FR-E13-4)
- Sandbox keys + seed data + docs page; partner integrates unaided ≤ 2 dev-days (FR-E13-5)
- Credits wallet: per-mode rates (text 1, voice 2, video 3, human-facilitated 1), debit on interview start, refund on system failure, concurrency-safe ledger (FR-E14-1)
- Low-balance alerts + blocked-at-zero with grace for in-flight sessions (FR-E14-2)
- Pilot plan: manual credit grants by us (FR-E14-3)
- `candidate.external_ref` linkage end-to-end (validation-layer identity)

**Out**
- Razorpay charging (Phase 11, behind flag), subscriptions (M2), full public API surface beyond these routes (V2)

## Deliverables

- `integration-api` module (separate router/guard stack from the web app), OpenAPI docs page
- Webhook delivery worker with backoff/DLQ + replay tooling
- `billing` module: wallet, ledger, low-balance notifier (email), admin grant tool
- Validation-layer runbook + turnaround (≤ 24 h) metric dashboard

## Technical approach & patterns

- Idempotency keys + unique constraint on `(org, external_ref, kit_version)` — retries are free (Blueprint §17.2)
- Ledger correctness: single-writer debit path with balance check in the same transaction; refund on `session.system_failed` event
- Webhook signing: HMAC with rotatable secrets; deliveries journaled; partner flakes absorbed by backoff + DLQ, never dropped
- Blocked-at-zero with grace: in-flight sessions always finish; only *new* starts block (FR-E14-2)

## Third-party integrations allowed this phase

None new (manual credit grants; Razorpay next phase behind flag).

## Testing strategy

- Contract: OpenAPI schema tests; scorecard JSON schema versioned + matches web report renderer
- Integration: idempotent create (duplicate external_ref), webhook retry/backoff/replay, ledger concurrency (parallel debits), refund on simulated system failure
- E2E (the validation loop): API creates interview (inline JD) → candidate completes → `report.ready` webhook → scorecard fetched — all without touching the web UI

## Git plan

- `phase-10/api-keys-v1`, `phase-10/interviews-endpoints`, `phase-10/webhooks`, `phase-10/credits-wallet`
- Tag: `phase-10-complete`

## Exit gate

The existing product completes the full loop programmatically in sandbox: push candidate+JD → interview happens → scorecard webhook ingested.

## Verification ✅

- [ ] API-key auth on 100% of `/v1` routes; rotation + scoping + rate limits tested (FR-E13-1)
- [ ] Idempotency proven: repeated POST with same `external_ref+kit` returns the same interview, no duplicate invite (FR-E13-2)
- [ ] Webhook delivery ≥ 99.5% within 1 min after retries in failure-injection tests; HMAC verification + replay work (FR-E13-4)
- [ ] Ledger: concurrency-safe debits (race test), exact balance_after chain, refunds on system failure (FR-E14-1)
- [ ] Blocked-at-zero blocks new starts but never interrupts in-flight sessions (FR-E14-2)
- [ ] Sandbox: fresh test key → seed data → docs-only integration by an engineer not on the project ≤ 2 dev-days (FR-E13-5)

## Validation ✔️

- [ ] The existing product's team (or a stand-in) drives the full loop from their own codebase and confirms the scorecard slots into their candidate records (assumption A1 made concrete)
- [ ] Turnaround metric live: API-created interview → scorecard delivered, P95 tracked against ≤ 24 h SLA
- [ ] Docs page reviewed by the partner-facing engineer: complete, copy-paste-runnable examples

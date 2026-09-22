# Partner Integration Runbook — Validation-Layer Loop

**Audience:** an engineer integrating ZIOS as a validation layer (push candidate + JD → receive a structured scorecard). **Scope:** Phase 10 integration API (FR-E13), credits wallet (FR-E14). No web UI required — everything below is copy-paste runnable against a sandbox.

**Status:** validated 2026-09-22 — the full loop below was executed end-to-end over HTTP only (no UI, no internal tools) by a stand-in engineer; see `phases/phase-10-integration-api-billing.md` §Validation.

---

## 0. What you get

- `POST /v1/interviews` — create an interview from a `kit_id` or a raw `jd_text`; **idempotent** on `(your external_ref, kit)`.
- `GET /v1/interviews/{id}` — poll status (`invited` → `completed`).
- `GET /v1/interviews/{id}/scorecard` — structured JSON scorecard (`schema_version: "v1"`): scores, evidence spans, integrity flags, recommendation.
- Webhooks — `interview.completed` and `report.ready`, HMAC-signed, retried with backoff, replayable.
- Credits: prepaid wallet; per-mode prices debited when an interview **starts**; 402 when balance can't cover a new start (in-flight interviews always finish).

## 1. Get a sandbox key

Ask us for a **test** API key (`zios_test_…`, shown once) or self-serve in the sandbox:

```bash
node scripts/seed-integration-sandbox.js --email you@yourcompany.com
# Prints: API key (once), published kit id, and the exact curl commands.
```

Key facts: sha256-hashed server-side (raw key never stored), scopes (`interviews:read`, `interviews:write`), per-key rate limit (default 120 req/min → 429 + `Retry-After`). Rotate/revoke via `POST /integration-api/keys/:id/rotate|revoke`.

## 2. Create an interview

Exactly one of `kit_id` / `jd_text`:

```bash
curl -X POST "$API/v1/interviews" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "kit_id": "<kit-uuid>",
    "mode": "text",
    "candidate": {
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "external_ref": "candidate-001"
    }
  }'
```

- `201` → `{ "interview_id", "invite_link", "status": "invited", "idempotent_replay": false }`. `invite_link` is the candidate-facing URL (send it to the candidate however you like; it is also **shown once** — store it).
- Retries: POSTing the same `(external_ref, kit)` again returns the **same** `interview_id` with `"idempotent_replay": true` and `invite_link: null` — safe to retry forever.
- `jd_text` path: send `"jd_text": "<job description>"` instead of `kit_id`; a kit is generated and published for you.
- Modes: `text` (1 cr), `voice` (2 cr), `video` (3 cr), `human` (1 cr). `async_video` → 422 `MODE_NOT_SUPPORTED` on this endpoint.
- Errors: 401 `INVALID_API_KEY` · 403 scope · 422 `MODE_MISMATCH` / validation · 429 `RATE_LIMITED` · 402 `INSUFFICIENT_CREDITS`.

## 3. The candidate interviews

The candidate opens `invite_link`, consents, and interviews in the browser. Nothing for you to build. Status transitions you will see from polling:

```
invited → in_progress (candidate opened / interview live) → completed
```

## 4. Get the result

Poll (or wait for the webhook, §5):

```bash
curl "$API/v1/interviews/<interview_id>" -H "Authorization: Bearer $KEY"
# → { "id", "status", "mode", "candidate": { "external_ref" }, "created_at", "completed_at" }

curl "$API/v1/interviews/<interview_id>/scorecard" -H "Authorization: Bearer $KEY"
# → 404 until the report exists, then:
# { "schema_version": "v1", "scores": [...], "evidence_spans": [...],
#   "integrity_flags": [...], "recommendation": {...}, ... }
```

Key into the scorecard by your own id: `candidate.external_ref` (validated end-to-end — the same value you sent at create time comes back in the status payload and webhook data).

## 5. Webhooks (optional but recommended)

Register an endpoint (admin UI → Settings → Webhooks, or ask us):

- Events: `interview.completed`, `report.ready`.
- Signature header on every delivery: `X-Zios-Signature: t=<unix>,v1=<hmac_sha256(secret, "<t>.<rawBody>")>` + `X-Zios-Event: <event>`. Verify with constant-time compare before trusting the body.
- Failures retried with backoff (1m, 5m, 30m, 2h, 12h; 5 attempts) — deliveries are journaled, never dropped; ask us to replay any delivery.
- Per-request `callback_url` on create also works (validated as https except localhost); org-level endpoints fire too.

## 6. Turnaround metric (≤ 24 h SLA)

P95 from API-created to report delivered, straight from the delivery journal:

```sql
SELECT
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY wd.delivered_at - ei.created_at
  ) AS p95_api_created_to_report_ready
FROM webhook_delivery wd
JOIN session_event se ON se.id = wd.session_event_id
JOIN external_interview ei ON ei.invite_id = se.invite_id  -- adjust join to your session_event→invite path
WHERE wd.event = 'report.ready' AND wd.status = 'delivered';
```

(Verified columns: `webhook_delivery.delivered_at`, `external_interview.created_at`; join path `session_event → invite` per your schema version.)

## 7. Sandbox checklist (what "done" looks like)

1. Create → 201 with `interview_id` + `invite_link`.
2. Same POST again → same `interview_id`, `idempotent_replay: true`.
3. Candidate completes the interview from the link.
4. Status poll reaches `completed`.
5. Scorecard 200 with `schema_version: "v1"`, non-empty `scores` + evidence.
6. (Webhook sink) signature verifies; a forced 500 recovers on backoff.

All six were executed 2026-09-22 against a live host-run API from curl/HTTP only — transcript in the phase file's Validation section.

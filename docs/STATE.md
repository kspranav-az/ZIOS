# State — InterviewOS / Meridian MVP

**Snapshot date:** 2026-09-22 · **HEAD:** `main` (Phase 10 complete — credits-wallet merge `dfe302e` + final-validation merge; all merges `--no-ff`, history preserved per owner) · **Remote:** `origin` = `git@github.com:kspranav-az/ZIOS.git` (all branches + tags pushed) · **Tags:** `phase-00-complete` … `phase-09b-complete`, `phase-10-complete`, `phase-14-complete`, `v0.1.0-mvp0-mock` · **Phase 10 ✅ complete** (E13 + E14 closed; validation evidence in `phases/phase-10-integration-api-billing.md`; one open item: owner review of `docs/partner-integration-runbook.md`) — next: Phase 11

This file records the current implementation state, what is proven, what is not, and where the blockers are.

---

## 1. Build status

| Check                      | Result                                             | Command                                        |
| -------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| API unit + integration     | ✅ 271 passed / 48 files                           | `pnpm --filter @zios/api test`                 |
| Orchestrator pytest        | ✅ 104 passed / 2 skipped                          | `cd services/ai-orchestrator && uv run pytest` |
| Orchestrator ruff + mypy   | ✅ Clean (mypy strict)                             | `uv run ruff check app tests && uv run mypy`   |
| Employer unit              | ✅ 92 passed                                       | `pnpm --filter employer-web test`              |
| Employer typecheck + lint  | ✅ Clean (1 pre-existing warning in CockpitPage)   | `pnpm --filter employer-web typecheck/lint`    |
| Candidate typecheck + lint | ✅ Clean                                           | `pnpm --filter candidate-web typecheck/lint`   |
| Employer E2E               | ✅ 12 passed                                       | `pnpm --filter employer-web e2e`               |
| Candidate E2E              | ✅ 5 passed                                        | `pnpm --filter candidate-web e2e`              |
| Docker Compose             | ✅ All healthy (orchestrator pinned `linux/amd64`) | `docker compose up -d --build`                 |

---

## 2. Feature completion by PRD epic

| Epic | Description               | Implemented?   | Notes                                                                                                                                                                                                                                                                   |
| ---- | ------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1   | Employer onboarding       | ✅             | Email OTP, org auto-creation, Admin/Interviewer roles; Google OAuth stubbed                                                                                                                                                                                             |
| E2   | Interview Kit Builder     | ✅             | CRUD, topics/questions, follow-up policy, timers, versioning, preview-as-candidate                                                                                                                                                                                      |
| E3   | JD-based generation       | ✅             | JD → proposal → review → publish; per-question regenerate; template gallery                                                                                                                                                                                             |
| E4   | Question sources          | ✅             | Seeded question bank + external adapter interface; provenance tracked; role-based question table added for async video                                                                                                                                                  |
| E5   | Scheduling & invites      | ✅             | Single + CSV bulk invites, token-bound links, candidate identity, optional OTP, reschedule-by-link, .ics for human mode                                                                                                                                                 |
| E6   | Candidate experience      | ✅             | Mobile-first web, preflight, consent, practice question, text/voice/video/async video, session recovery                                                                                                                                                                 |
| E7   | AI interviewer            | ✅             | Text + voice conductor; adaptive follow-ups behind mock LLM; timers; wrap-up                                                                                                                                                                                            |
| E8   | Human-facilitated mode    | ✅             | LiveKit room, slot scheduling, cockpit, coverage tracking, auto-notes, structured scorecard                                                                                                                                                                             |
| E9   | Proctoring (baseline)     | ✅             | Consent-gated snapshots, tab-switch/fullscreen-exit, copy-paste capture, integrity flags panel                                                                                                                                                                          |
| E10  | Evaluation & report       | ✅             | Transcript, rubric scores + evidence, communication metrics, integrity panel, override, PDF, share link                                                                                                                                                                 |
| E11  | Notifications             | ⚠️ Partial     | Email via Mailpit only; WhatsApp/SMS deferred to Phase 11                                                                                                                                                                                                               |
| E12  | Dashboard (pipeline-lite) | ✅             | Interview list, statuses, kit stats, filters; async-video rows now route to review page instead of report                                                                                                                                                               |
| E13  | Integration API           | ✅             | API keys (guard, scopes, rate limit, rotation, UI); `/v1/interviews` idempotent create + status + scorecard v1 (kit_id/jd_text, sandbox seed); webhooks (signed, journaled, retried, replay, UI); DLQ redrive endpoints; partner loop validated over live HTTP 2026-09-22 (runbook: `docs/partner-integration-runbook.md`) |
| E14  | Billing-lite              | ✅             | Credit ledger; async-video debit/refund (09b) + pricing map {text:1, voice:2, video:3, human:1, async_video:3}; atomic start charge (tx-rolled-back on downstream fault); orchestrator-failure refund with dedupe; 100-credit welcome grant; blocked-at-zero (in-flight never interrupted); low-balance email alerts 1/24h; wallet API + Wallet UI; grant-credits ops script. Real payments remain post-M1 (Phase 11 flag) |
| E15  | Async video interviews    | ✅             | Formal M1 mode as of PRD update; role-based creation, per-question recording, transcription, review, AI pre-fill + human scorecard, report, credit debit; see `phases/phase-09b-async-video-hardening.md`                                                               |

> Async video was originally added as a validation-layer shortcut. It is now **E15 in the PRD §3.4 IN list** with formal acceptance criteria and a scope trade (FR-E10-5 candidate comparison view deferred to M2).

### Post-M1: Phase 14 — Multimodal feature extraction (✅ complete, merged to `main`)

Post-M1 extension (not in the frozen PRD §3.4): objective multimodal feature extraction for one-way recorded modes. Plan: `phases/phase-14-multimodal-analysis.md`. **Complete and tagged `phase-14-complete` (2026-09-12); validated end-to-end on the bundled 150 s interview clip.**

- Generalized `analysis_job` lifecycle (kinds `transcription` / `multimodal_feature_extraction`) + `analysis_job_dlq`; BullMQ `analysis` queue; consent-gated (`CONSENT_MISSING` fails without processing); legacy `transcription_job` path untouched behind `enableAnalysis: false`.
- Orchestrator `app/analysis/`: streaming ffmpeg preprocessing (16 kHz mono PCM; 5 FPS / ~854 px sequential frames), MediaPipe face/pose/hands (gaze as `camera_gaze_ratio`, head pose via solvePnP, facial activity, posture, gesture frequency, blur/quality), Silero VAD via onnxruntime, librosa pitch/energy (speech regions only), WPM/fillers/repetitions (heuristics flagged), temporal alignment + 3-level aggregation, pydantic schema (`value/valid/reason` — no fake zeros), artifacts in MinIO `analysis/{sessionId}/{questionId|session}/*.json`, typed errors (2xx/4xx/5xx, never 200-with-fake).
- `STT_ADAPTER=mock|gcp` factory + `GoogleCloudSttAdapter` (Speech v2, word timestamps, normalized internal schema); mock remains the default everywhere.
- Video-mode capture: hidden subscribe-only LiveKit recorder participant → streaming webm encode → `recordings/{sessionId}/{sha256}.webm` → telemetry (`media_kind`) → analysis enqueue; voice-mode recordings (`...wav`) enqueue audio analysis.
- Employer review page: `AnalysisFeaturesPanel` per question (objective measurements only, `n/a — reason` for invalid, `heuristic` badges); API `GET /analysis/sessions/:id` + `GET /analysis/sessions/:id/questions/:qid/features`.
- **No inference:** no emotion/personality/lie/confidence scoring anywhere in the pipeline.

---

## 3. Mock-credential mode inventory

Everything below is **fixture-driven mock** today. Feature code is complete; real adapter plugs into the same port.

| Capability                         | Port / adapter                                                                               | Mock behavior                                                                                                                                                  | Real handover item                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| LLM (generation, conductor, judge) | `LlmProvider` → `MockLlmProvider`, `GeminiLlmProvider`                                       | Deterministic fixtures for JD analysis, follow-ups, scores; Gemini adapter (gemini-3.5-flash-lite default) with versioned prompt registry + `MOCK_MODE` toggle | Prompt tuning + cost validation against real traffic |
| STT                                | `SttPort` → `MockSttAdapter` / `GoogleCloudSttAdapter` (via `STT_ADAPTER=mock\|gcp` factory) | Scripted transcript fixtures; GCP adapter implemented + contract-tested with fakes                                                                             | GCP credentials + WER measurement (adapter ready)    |
| TTS                                | Orchestrator contract → `MockTtsAdapter`                                                     | Pre-recorded audio fixtures                                                                                                                                    | ElevenLabs/PlayHT + latency measurement              |
| Google OAuth                       | `OAuthPort` → `MockOAuthAdapter`                                                             | Accepts any `code` and returns deterministic profile                                                                                                           | Real Google OAuth app + verification                 |
| Email                              | `EmailSender` → `MailpitAdapter`                                                             | Sends via local SMTP                                                                                                                                           | Production SMTP/SES + deliverability                 |
| Storage                            | `S3Client` → `MinIOAdapter`                                                                  | Local S3-compatible buckets                                                                                                                                    | AWS S3/GCS + lifecycle policies                      |
| Media                              | LiveKit self-hosted                                                                          | Real WebRTC rooms, dev keys                                                                                                                                    | LiveKit Cloud/managed cluster + TURN                 |
| Payments                           | Wallet schema stub                                                                           | Manual ledger only                                                                                                                                             | Razorpay KYC + payment port                          |
| WhatsApp/SMS                       | —                                                                                            | Not implemented                                                                                                                                                | Twilio/WhatsApp Business approval                    |
| Async video transcription          | `AsyncVideoTranscriptionService` → `SttPort`                                                 | ffmpeg audio extraction + mock STT; BullMQ worker with 3 retries + DLQ                                                                                         | Real STT adapter only; worker infra is ready         |

---

## 4. Test evidence by phase

### Phase 14 — Multimodal analysis (branch `ai-analysis`, ✅ validated)

- Orchestrator `services/ai-orchestrator/tests/analysis/` (7 files): gaze/head-pose/posture/hand geometry, VAD merging, pause/WPM/filler/disfluency detection, pitch/energy aggregation, alignment, 3-level aggregation, config, error taxonomy; contract suite passes for both `MockSttAdapter` and faked `GoogleCloudSttAdapter`; pipeline integration (generated WebM → `/analysis/video` → 200 schema-valid; 404 missing object; 422 corrupt media; 502 STT failure; 400 consent not verified). Total 104 passed / 2 skipped (opt-in live voice E2E).
- `services/ai-orchestrator/tests/test_video_capture.py` (16 tests): webm encoder (ffprobe-verified vp8+opus, downscale, downmix), audio-only fallback, telemetry `media_kind` routing, recorder token grants.
- API `src/modules/analysis/*.spec.ts` + `src/testing/integration/analysis.integration.spec.ts`: lifecycle transitions, orchestrator client typed errors + `ORCHESTRATOR_TIMEOUT`, consent gating, happy path with transcript write-back, 502×3 → DLQ with typed errors, tenant 404. API total 271 passed / 48 files.
- Employer: `analysis-features-panel.test.tsx` (13 tests) + e2e stub in `async-video-review.spec.ts`; employer-web e2e 12/12, candidate-web e2e 5/5.
- **Live validation PASSED** on `test_video/interview_video_clip_test.mp4` (150 s interview clip, `scripts/seed-multimodal-analysis-validation.js`, session `bb67e8e7`): face_visible 0.91, camera_gaze_ratio 0.971, yaw/pitch/roll −6.7°/6.9°/0.05°, posture upright 1.0 (posture_valid 0.72), hands_visible 0.30, speaking 135.9 s / 14 pauses, pitch 235.8 Hz, blur 0, 16 windows, interaction correctly `valid:false single_speaker_recording`. Validation found and fixed 4 real bugs: head-pitch 180° offset, negative gesture_duration, integration-test workers stealing live queue jobs (root cause of orphaned `pending` jobs), stale candidate routing test.
- Failure drills for real: `ORCHESTRATOR_UNREACHABLE` → 3 retries → DLQ → re-drive (`scripts/redrive-analysis-job.js`) → completed; `CONSENT_MISSING` fails without calling the orchestrator; `STT_ADAPTER=gcp` without credentials fails loudly; bogus adapter value errors at boot.
- Scripts: `scripts/seed-multimodal-analysis-validation.js` (seed → upload clip → poll → print features), `scripts/redrive-analysis-job.js` (re-enqueue stuck jobs).

### Async video interviews (post-Phase 09 addition)

- `services/api/src/testing/integration/async-video.integration.spec.ts`: create, consent, questions, upload, review, score; verifies `transcription_job` is created and completed.
- `services/api/src/testing/integration/async-video-dlq.integration.spec.ts`: isolates a failing orchestrator and confirms the worker retries and then writes to `transcription_job_dlq`.
- `services/ai-orchestrator/tests/test_video_transcription.py`: ffmpeg extraction + `SttPort` routing, fallback on invalid video/STT failure, healthcheck.
- `apps/employer-web/e2e/async-video-review.spec.ts`: employer reviews videos + transcripts + per-question scores.
- `apps/candidate-web/e2e/async-video-journey.spec.ts`: candidate consent → recorder UI → question navigation.
- `scripts/seed-async-video-validation.js`: manual end-to-end seed for candidate record → employer review flow.

### Phase 09b — Async video hardening

- `services/api/src/testing/integration/async-video-hardening.integration.spec.ts`: AI judge pre-fill (evidence-linked scores per question), scorecard submit → `evaluation_report` in live-mode schema, credit debit on create, refund before first answer only.
- `services/api/src/testing/unit/credits.service.spec.ts`: ledger append-only invariants, debit/refund balance math, insufficient-credits mapping (note: `org` has no `updated_at`; adjustCredits must not reference it or debit fails as 402).
- `apps/employer-web/e2e/async-video-review.spec.ts` extended: pre-fill → edit → submit → report render.
- `phases/phase-09b-async-video-hardening.md`: all verification and validation checkboxes ticked; tagged `phase-09b-complete`.

### Phase 10 — Branch 3: Webhooks (FR-E13-4)

- New `webhook_endpoint` (url, shown-once secret, events ⊆ {interview.completed, report.ready}, active) + `webhook_delivery` (durable journal; unique `(endpoint_id, session_event_id)` = dedupe; status pending/delivered/failed, attempts, next_attempt_at; migration `1790100800000_webhooks`).
- `services/api/src/modules/webhooks/`: `WebhooksRepository`, `WebhookFanoutService` (writes delivery rows in-transaction; BullMQ jobs enqueued only after commit), `WebhooksProcessor` (HMAC `X-Zios-Signature: t=…,v1=…` + `X-Zios-Event`, 10s timeout via `WEBHOOK_TIMEOUT_MS`, backoff 1m/5m/30m/2h/12h via `WEBHOOK_BACKOFF_MS`, 5 attempts → failed, journaled + replayable), `WebhooksController` (`/webhooks/endpoints` CRUD + `/webhooks/deliveries?status=` list + admin `POST /webhooks/deliveries/:id/replay`).
- Fanout call sites: sessions wrapup (interview.completed) and evaluation report finalization (AI judge + human scorecard both journal a `report.ready` session_event and fanout on it).
- Integration spec `webhooks.integration.spec.ts` (5 tests, hermetic `node:http` sink, per-boot UUID queue isolation): signed happy path for both events (signature re-verified in-test, envelope contract asserted), 500→backoff→recover, hang→timeout attempt→recover, 5-attempt exhaustion→admin replay, dedupe on re-emit. Unit: `webhook-signing.spec.ts` (roundtrip/tamper/backoff schedule). API suite 303 passed / 2 skipped.
- employer-web: **Webhooks page** at `/settings/webhooks` (shell nav): endpoint list + create (secret reveal modal) + deactivate, delivery log with status filter + replay (admin only); `webhooks-page.test.tsx` (4 tests). employer-web 100 passed.

### Phase 10 — Branch 4: Credits wallet (FR-E14-1/2/3)

- Pricing single source of truth: `services/api/src/modules/credits/pricing.ts` — pricing *kinds* differ from session modes (`InterviewMode` has no human/async_video), so `CREDIT_PRICING = {text:1, voice:2, video:3, human:1, async_video:3}`; `priceForSession(mode, conductor)` (human conductor → flat 1, no AI judge stack); `assertCanStart` fails fast with 402 `INSUFFICIENT_CREDITS`. Unit: `pricing.spec.ts` (7 tests).
- Atomic start charge: the only live transition is `advanceSessionStatus` from preflight — debit runs in the same transaction, so any downstream fault rolls the charge back automatically (no refund code path for ordinary failures). `charge{balanceAfter}` is surfaced post-commit to fire the low-balance alert. Zero balance blocks NEW starts (402) while in-flight sessions complete without re-charge by design.
- Orchestrator-failure refund (FR-E14-2): voice `issueToken` wraps the orchestrator fetch; network failure or non-2xx refunds `priceForSession(mode, conductor)` as `system_failure_refund`, guarded by `hasRefundForSession` (unique ledger reason+sessionRef check) so retries can't double-refund. Refund scope is honestly enumerated: orchestrator token unavailability only.
- Welcome grant: `provisionSignup` grants 100 credits (`welcome_grant` ledger row) in the same transaction as org+user creation — new orgs can interview immediately and every existing integration test stays solvent.
- Low-balance alerts (FR-E14-3): `CreditsAlertService` — post-debit balance below the org threshold emails all admins, redis `lowbal:{orgId}` watermark (SET NX EX 86400) = at most 1 email/24h; every failure is logged and swallowed so alerting never blocks the debit path. Threshold per org (`low_balance_threshold`, default 5; `org` has no `updated_at`), editable via `PATCH /credits/wallet/threshold` (admin, 0..1 000 000).
- Wallet API: `GET /credits/wallet` (balance, threshold, pricing map, append-only ledger newest-first). Ops script `scripts/grant-credits.js <orgName> <amount> [reason]` (transactional adjust + `admin_grant` ledger row).
- Integration spec `credits-wallet.integration.spec.ts` (6 tests): welcome grant + pricing + admin-only threshold; mode-priced debit with balance-chained ledger; zero-balance block with in-flight completion; concurrent-start race (exactly one 200/one 402, ledger exact); voice-token 502 → refund with session linkage; low-balance email once/24h (second debit suppressed). Mailpit test-infra fix: `MP_MAX_MESSAGES=5000` (default 500-prune made `waitForEmail` flaky under a live stack).
- employer-web: **Wallet page** at `/settings/wallet` (shell nav): balance card with low-balance badge, threshold edit (admin only), pricing table, ledger table (debits vs refunds color-coded); `wallet-page.test.tsx` (2 tests). API suite 316 passed / 2 skipped; employer-web 102 passed.

### Phase 10 — Branch 2: /v1 interviews (FR-E13-2/3)

- New `external_interview` table (org-scoped, idempotent unique `(org_id, external_ref, kit_version_id)`, FKs CASCADE; migration `1790097664987_external-interview`).
- `services/api/src/modules/integration-api/`: `ExternalInterviewRepository` (insert-idempotent ON CONFLICT DO NOTHING), `V1InterviewsService`, `InterviewsController` at `/v1/interviews` (`@Public()` + `ApiKeyGuard`, scopes `interviews:write`/`interviews:read`). Create via `kit_id` or `jd_text` (JD analysis → proposal → publish with settings overrides); text/voice/video/human modes, `async_video` → 422 `MODE_NOT_SUPPORTED`; kit mode mismatch → 422 `MODE_MISMATCH`; idempotent replay returns same `interview_id` with `invite_link: null` + `idempotent_replay: true` (raw token unrecoverable by design).
- API-key requests run as the org's first app_user inside `TenantContext.run` (withTenant fails closed otherwise); `GenerationService.publishProposal` / `KitsService.createFromProposal` gained an optional `settingsOverrides` param.
- `scripts/seed-integration-sandbox.js`: end-to-end sandbox seed (OTP signup via Mailpit → published kit → test API key → 500 credits) printing the partner curl loop; verified against a live host-run API.
- Tests: `v1-interviews.integration.spec.ts` (6 tests): kit_id + jd_text create, idempotent retry, 401/403/cross-org-404 authz matrix, MODE_MISMATCH/async_video rejection, full journey to scorecard v1 (real text interview via candidate API + pollForReport). API suite 293 passed / 2 skipped.

### Phase 10 — Final validation & close-out

- **Sandbox loop (FR-E13-5) executed over live HTTP only** (stand-in partner engineer, 2026-09-22): `scripts/seed-integration-sandbox.js` → fresh org + test key + published kit → `POST /v1/interviews` 201 with `invite_link` → idempotent replay (same `interview_id`, `idempotent_replay: true`, link not re-exposed) → candidate flow via invite token (consent → live → 2 turns → wrapup) → status poll `completed` → scorecard 200 `schema_version: "v1"` with scores + evidence spans → sandbox org wallet 500 → 499 (exactly 1 text credit debited at start). Transcript recorded in `phases/phase-10-integration-api-billing.md` §Validation.
- `docs/partner-integration-runbook.md` — copy-paste-runnable partner runbook (create/poll/scorecard/webhooks/P95 SQL); every command executed in the sandbox run; **owner review pending** (last open item).
- Pre-existing breakage fixed on main: `TokenLandingPage` routing tests failed since the async-video era — react-router v7 data routers build `new Request(url, {signal})` on navigation and undici rejects jsdom-realm `AbortSignal`s ("Expected signal to be an instance of AbortSignal"), so `navigate()` rejected silently. Fix: candidate-web test setup wraps global `Request` to drop foreign signals (`apps/candidate-web/src/test/setup.ts`). candidate-web 13/13 green again.
- Final numbers: API 316 passed / 2 skipped (57 files + 1 skipped), lint + typecheck clean · employer-web 102 passed, tsc clean · candidate-web 13 passed, tsc + lint clean. E2E not re-run (compose API image predates Phase 10; unit/integration suites cover the changed surface — rebuild images before the next E2E pass).
- `docs/PRESENTATION.md` (demo script with mermaid diagrams, design decisions, live-demo checklist) written at Phase-10 kickoff; checkboxes ticked in `phases/phase-10-integration-api-billing.md` with evidence.

### Phase 10 — Branch 0: DLQ redrive

- `services/api/src/testing/integration/dlq-redrive.integration.spec.ts` (3 tests, per-boot UUID queue isolation for both queues, local `node:http` orchestrator stub): analysis job 502×3 → DLQ → admin redrive → completes, DLQ row removed; transcription DLQ likewise; 404 for unknown ids, 403 `FORBIDDEN_ROLE` for interviewers.
- Endpoints: `POST /analysis/dlq/:jobId/redrive` (analysis job id) and `POST /async-video-interviews/dlq/:transcriptId/redrive` (transcript id), both `@Roles('admin')` + org-scoped, reset-and-re-enqueue in one transaction, BullMQ added after commit. Replaces `scripts/redrive-analysis-job.js`.

### Phase 10 — Branch 1: API keys (FR-E13-1)

- New `api_key` table (sha256 hash only, `zios_test_/zios_live_` format, shown once at create/rotate; scopes + per-key rate limit; migration `1790086311907_api-key`).
- `services/api/src/modules/integration-api/`: `ApiKeysService` (create/rotate/revoke/list, org-scoped), `ApiKeyGuard` (Bearer → hash → active lookup → `@Scopes` check → Redis fixed-window rate limit → 429 + Retry-After), `KeysController` at `/integration-api/keys` (session-authed; mutations `@Roles('admin')`).
- Tests: unit (service + guard, `api-keys.service.spec.ts` / `api-key-auth.guard.spec.ts`), integration `api-keys.integration.spec.ts` (full HTTP lifecycle, 401/403 matrix, cross-org 404, raw key never persisted); employer-web `api-keys-page.test.tsx` (4 tests).
- employer-web: **API Keys page** at `/settings/api-keys` (shell nav "API Keys"): list (prefix/kind/scopes/limits/status), create test|live, rotate/revoke (admin only), one-time reveal modal with copy.
- API suite 287 passed / 2 skipped; employer-web 96 passed.

### Phase 09 — Human-facilitated

- `services/api/src/testing/integration/phase09.integration.spec.ts` (8 tests): scheduling, .ics, slot window, cockpit coverage, end-call notes, reschedule request/confirm, scorecard prefill/submit, no-AI-scoring proof, dashboard surfacing.
- `apps/employer-web/e2e/human-facilitated.spec.ts`: schedule → cockpit → coverage → end call → scorecard → report.

### Phase 08 — Video & proctoring

- `phase08.integration.spec.ts` (4 tests): strict interview with integrity flags and human disposition.
- `apps/candidate-web/e2e/video-journey.spec.ts`: full video candidate flow.

### Phase 07 — Voice

- `apps/candidate-web/e2e/voice-journey.spec.ts`: voice invite → consent → voice room → fallback to text.

### Phase 06 — LLM gateway

- `llm-gateway.spec.ts`, `adapter-contract.spec.ts`, `oauth.spec.ts`, `stub-judge.adapter.spec.ts`.

### Phase 05 — JD generation

- `phase05.integration.spec.ts` (3 tests), `jd-generation.spec.ts` E2E.

### Phase 04 — Evaluation & dashboard

- `phase04.integration.spec.ts` (4 tests), `report-dashboard.spec.ts` E2E.

### Phase 03 — Invites & text interview

- `phase03.integration.spec.ts` (6 tests), `candidate-journey.spec.ts` and `recovery.spec.ts` E2E.

### Phase 02 — Kit builder

- `kits.integration.spec.ts` (7 tests), `question-bank.integration.spec.ts` (6 tests), `kit-builder.spec.ts` E2E.

### Phase 01 — Identity & orgs

- `auth-flow.integration.spec.ts` (10 tests), `tenant.integration.spec.ts` (4 tests), `auth.spec.ts` E2E.

### Phase 00 — Foundation

- Health checks, migrations, CI workflow.

---

## 5. Known gaps / blockers

| Gap                                            | Why it matters                                                                                                                                    | Next action                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live LiveKit capture not yet proven            | Video-mode track capture + voice-recording analysis are unit/integration-tested only; no real browser LiveKit session has run through analysis    | First real voice/AI-video session: verify `recordings/*.webm` lands in MinIO and its analysis job completes                                      |
| Orchestrator is `linux/amd64`-only             | mediapipe 1.0.1 crashes on macOS/arm64 and ships no linux/aarch64 wheel → pinned 0.10.21, emulated amd64 on ARM hosts (slow: 150 s clip ≈ 30 min) | Revisit when mediapipe ships aarch64; CI on x86 is native                                                                                        |
| `.env` DATABASE_URL stale (5432 vs 55432)      | Host-run tests/scripts fail against compose Postgres on 55432                                                                                     | Reconcile `.env` with compose port override                                                                                                      |
| Phase 10 complete (2026-09-22)                 | —                                                                                                                                                 | ✅ Tagged `phase-10-complete`; validation evidence in `phases/phase-10-integration-api-billing.md`; owner review of `docs/partner-integration-runbook.md` pending |
| Phase 11 not started                           | No pilot hardening, load test, or notifications                                                                                                   | Start after Phase 10                                                                                                                             |
| No real LLM/STT/TTS validation                 | X2, X6, X7, WER cannot be measured                                                                                                                | ✅ GCP STT validated live 2026-09-22 (Speech v2, 373 words / 150 s clip, word timestamps); Gemini LLM adapter ready — wire keys when they arrive |
| No real Google sign-in                         | FR-E1-1 not fully validated                                                                                                                       | Add real Google OAuth app                                                                                                                        |
| No WhatsApp/SMS                                | E11 partial                                                                                                                                       | File template approvals (already noted as Week-1 exception)                                                                                      |
| No production infra                            | Cannot deploy outside Docker Compose                                                                                                              | Define k8s/managed infra post-M1                                                                                                                 |
| Human-facilitated video stability under stress | LiveKit rooms work locally; multi-participant + TURN not validated                                                                                | Re-test after Cloud TURN + run load scenario                                                                                                     |

---

## 6. Database state

All migrations through Phase 14 are applied in the compose stack. Key tables:

- Identity: `org`, `app_user`, `org_invite`, `session`
- Kit: `kit`, `kit_question`, `kit_version`, `question_bank_item`
- Interview: `invite`, `candidate`, `interview_session`, `session_transcript`, `consent`
- Evaluation: `evaluation_report`, `evaluation_score`, `evidence_span`, `score_override`, `interview_notes`
- Human-facilitated: `interview_slot`, `session_coverage`
- Integrity: `integrity_flag`, `integrity_snapshot`
- Generation: `jd_generation`
- Async video: `role_based_questions`, `async_video_review_score`, `transcription_job`, `transcription_job_dlq`, `credit_ledger`
- Analysis (Phase 14): `analysis_job`, `analysis_job_dlq`
- Infra: `evaluation_pipeline_log`, `preview_token`

Run `pnpm migrate` to verify no pending migrations.

---

## 7. Git hygiene

- **Branches:** All `phase-NN/*` branches preserved and pushed to GitHub. `phase-09b/async-video-hardening` (tagged `phase-09b-complete`) and `ai-analysis` (Phase 14, tagged `phase-14-complete`) were merged into `main` on 2026-09-22 with `--no-ff` merge commits (`4ff5d5b`, `3666889`) — full commit history preserved per owner request (not squash-merged).
- **Main:** Phase history plus merge commits for Phases 09b and 14; tags `phase-00-complete` … `phase-09-complete`, `phase-09b-complete`, `phase-14-complete`, and `v0.1.0-mvp0-mock`. Remote `origin` = `git@github.com:kspranav-az/ZIOS.git` (SSH; HTTPS lacked credentials on this machine).
- **Working tree:** Clean on `main` at snapshot time.

---

## 8. Immediate next steps

1. **Owner review:** read through `docs/partner-integration-runbook.md` (partner-facing) and `docs/PRESENTATION.md` (demo script) — the last open Phase-10 validation item.
2. **Live capture proof:** run one real voice/AI-video browser session; verify `recordings/*.webm` in MinIO + analysis completion (closes the last known Phase-14 gap).
3. **Provider procurement:** Select and obtain credentials for LLM, STT, TTS, Google OAuth, WhatsApp, and payments.
4. **Key handover re-run:** Re-execute credential-gated phase validations with real providers.
5. **Pilot preparation:** Identify ≥ 3 pilot employers per PRD exit criterion X9.
6. **Phase 11 kickoff:** pilot hardening, notifications (WhatsApp/SMS), Razorpay behind flag, load test — milestone tag `v0.2.0-pilot` comes after Phase 11, not now.

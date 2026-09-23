# CONTEXT.md — ZIOS Working Context

**Last updated:** 2026-09-23 · **Branch:** `main` (Phase 12 complete — M2 Ascend merged via `phase-12/*` branches, `--no-ff` merges, history preserved per owner; tagged `phase-12-complete`; `v0.2.0-pilot` intentionally waits for Phase 11) · **Remote:** `origin` = `git@github.com:kspranav-az/ZIOS.git` (SSH; all branches + tags pushed)

This file is the session-to-session handover: where the project is, how it runs, what's proven, what's pending, and the operational gotchas. Authoritative deep-dives live in `docs/` (`PRD`, `ARCHITECTURE.md`, `STATE.md`, `FEATURES.md`, `DEMO.md`) and `phases/`.

---

## 1. What this project is

ZIOS — an AI interview platform (ZeTheta). Monorepo (pnpm workspaces):

- `services/api` — NestJS modular monolith (strict TS), port `:3000`
- `services/ai-orchestrator` — Python 3.12 FastAPI (uv, ruff, mypy strict), port `:8000` — media/speech/analysis hot plane
- `apps/employer-web` (`:5173`, currently `:5273` — see §7) · `apps/candidate-web` (`:5174`) · `apps/ascend-web` (`:5175`, M2 candidate practice app) — React + Vite, TS only (`.tsx`, never `.jsx`)
- `packages/{ui,shared-types,config}` — design system + shared contracts
- `infra/migrations` — node-pg-migrate; expand-migrate-contract only
- `phases/` — the executable plan; a phase is done only when every verification + validation checkbox is ticked
- `AI-Interview-Platform/` — git-ignored design reference clone; theme/logo/flows are copied exactly, never invent divergent UI

## 2. Governance (AGENTS.md invariants — never trade away)

1. Consent before capture (X8) — no media processing without a stored consent artifact.
2. Evidence-linked scoring — every score cites transcript spans; schema-enforced.
3. AI never auto-rejects — flags + evidence; a named human dispositions.
4. No emotion/personality/face inference — observable measurements only.
5. Provider independence — no feature code names a vendor; everything external sits behind a port.
6. Docker-first: `docker compose up -d` is the only infra setup; tests hermetic against the compose stack.
7. Git: trunk-based, `main` always green; `phase-NN/<slug>` branches; Conventional Commits (imperative + body); squash-merge via PR; tag `phase-NN-complete` at gates; never commit secrets or `AI-Interview-Platform/`; never rewrite published history.
8. Third-party integrations are scheduled per phase — build against local stubs (Mailpit, MinIO, LiveKit dev, mock LLM/STT/TTS) until the provider's phase.

## 3. Feature status (all phases tagged complete)

- **Phases 00–09 + 09b + 14 + 12 complete.** Phase 10 (integration API + billing-lite) complete 2026-09-22, tagged `phase-10-complete` (partner loop validated over live HTTP; runbook `docs/partner-integration-runbook.md`; owner review of runbook pending). **Phase 12 (M2 Ascend) complete 2026-09-23, tagged `phase-12-complete`** — closed, grant-funded candidate practice beta: OTP candidate accounts + `CandidateAuthGuard` (audience-separated JWTs), practice engine on own tables (consent-gated X8, exact 1-credit live-transition debit, 3/day cap), judged reports with evidence-linked coaching tips, 4 LLM tasks (JD kit, resume parse, ATS check, resume-JD match with honesty guardrail), readiness formula `READINESS_FORMULA_V1` + progress/trend/streak, wallet ledger + candidate low-balance alerts, `apps/ascend-web` on :5175, ops runbook `docs/ascend-beta-runbook.md`. **Phase 12b (2026-09-23, follow-up merges on top of `phase-12-complete`, no new tag) closed both beta deferrals:** voice practice via record→transcribe→submit (`POST /cand/practice/:id/turn-audio` → MinIO → async-video `/video/transcribe` → editable transcript → turn carries `recordingRef`; exactly-2 debit) and resume PDF extraction (orchestrator `TextExtractorPort` + `POST /documents/extract-text`, pypdf via `DOCUMENT_EXTRACTION_ADAPTER`, Ascend `.pdf` file picker). Spec: `phases/phase-12b-voice-practice-pdf.md`. Phase 11 (notifications/hardening/pilot) is the only phase not started — it gates `v0.2.0-pilot`.
- **5 interview modes:** text (AI), voice (AI, LiveKit + text fallback), video (AI + proctoring baseline), human-facilitated (LiveKit cockpit, coverage tracking, scorecard), async video role-based (E15: create-by-role API, per-question recording → MinIO → transcription → review → AI pre-fill → human scorecard → report in live-mode schema; 3-credit debit, refund only before first answer).
- **Employer platform:** OTP auth (Mailpit), orgs + Admin/Interviewer roles, kit builder with immutable versions, JD→kit generation, question bank + `role_based_questions` (synced from external Neon DB — separate table, biweekly-ish upstream changes), invites (single/CSV, token links, OTP, reschedule, .ics), dashboard.
- **Evaluation:** evidence-linked reports, judge ensemble (2 parallel judges + adjudication), communication metrics, integrity panel, human overrides, PDF, share links.
- **Phase 10 — Integration API & credits wallet (E13/E14):** API keys (`zios_test_/zios_live_`, sha256-only, scopes, per-key rate limit, shown once); `/v1/interviews` idempotent create (unique `(org, external_ref, kit_version)`, replay returns same id + `idempotent_replay`, **201 on both first and replay**), status, scorecard v1 (`schema_version: "v1"`, shared evaluation read path); webhooks HMAC-signed (`X-Zios-Signature: t=…,v1=…`), journaled in `webhook_delivery` (dedupe via unique `(endpoint_id, session_event_id)`), backoff 1m/5m/30m/2h/12h ×5, admin replay; DLQ redrive endpoints (analysis + transcription, admin). Credits: pricing map kinds `{text:1, voice:2, video:3, human:1, async_video:3}` (`pricing.ts` — pricing kinds ≠ `InterviewMode`; human conductor prices flat); debit in the same tx as the live transition (downstream fault rolls back the charge = atomic refund); orchestrator voice-token failure refunds with `hasRefundForSession` dedupe; 100-credit `welcome_grant` at signup (keeps tests solvent); blocked-at-zero blocks new starts only (in-flight always finishes); low-balance email ≤1/24h per org (redis `lowbal:{orgId}` watermark, swallowed failures); wallet API + employer-web Wallet page; `scripts/grant-credits.js`. Partner-facing runbook + P95 SQL in `docs/partner-integration-runbook.md`.
- **Credits:** `credit_ledger` append-only; balance on `org.credits_balance`; insufficient → 402. ⚠️ `org` has **no `updated_at`** column — referencing it in credit queries silently breaks debit (learned the hard way).
- **Phase 14 — multimodal analysis (post-M1 extension):** generalized `analysis_job(kind, payload, status)` + `analysis_job_dlq`; BullMQ `analysis` queue; orchestrator `app/analysis/` — streaming ffmpeg preprocess (16kHz mono PCM; 5FPS/854px sequential frames), MediaPipe face/pose/hands (camera_gaze_ratio, solvePnP head pose, posture, gesture frequency, blur/quality), Silero VAD via onnxruntime (no torch), librosa pitch/energy over speech only, WPM/fillers/disfluency heuristics, temporal alignment + 3-level aggregation, pydantic schema (`Measurement{value,valid,reason,heuristic}` — no fake zeros), artifacts in MinIO `analysis/{sessionId}/{questionId|session}/*.json`, typed errors (2xx/4xx/5xx, never 200-with-fake). `STT_ADAPTER=mock|gcp` factory + `GoogleCloudSttAdapter` (Speech v2, word timestamps); mock is the default everywhere. Video-mode capture: hidden LiveKit recorder participant → webm → MinIO → telemetry → analysis. Employer review page has an objective-only features panel.

## 4. Test state (all green after Phase 12b merges, 2026-09-23)

- API: 364 passed / 2 skipped, 66 files (`pnpm --filter @zios/api test`; needs `DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos` inline — see §7); lint + typecheck clean
- Orchestrator: 118 passed / 2 skipped, ruff + mypy strict clean (`uv run pytest` etc. in `services/ai-orchestrator`)
- employer-web: 102 unit (tsc + lint clean), **12/12 E2E** · candidate-web: 13 unit (tsc + lint clean), **5/5 E2E** · ascend-web: 34 unit (tsc + lint clean), **4/4 E2E** (text + voice golden journeys, resume text + resume PDF) — E2E re-run 2026-09-23 on freshly rebuilt compose images, all green
- Live validation: 150s clip (`test_video/interview_video_clip_test.mp4`) through full pipeline — plausible features (face 0.91, gaze 0.97, 135.9s speech / 14 pauses, pitch 235.8Hz); GCP STT validated live 2026-09-22 (Speech v2, 373 words / 150 s clip, word timestamps)
- Partner loop (FR-E13-5): full validation-layer cycle driven over live HTTP only (create → idempotent replay → candidate interview → completed → scorecard v1; wallet debited exactly 1 text credit) — evidence in `phases/phase-10-integration-api-billing.md` §Validation
- Validation scripts: `scripts/seed-{human,async-video,voice,video-proctoring,structured-answers,multimodal-analysis,integration-sandbox}-validation.js`, `scripts/grant-credits.js`, `scripts/sync-role-based-questions.js`

## 5. Key architecture decisions

- Job pattern: durable DB row in-transaction + BullMQ enqueue after commit; in-process workers; retries ×3 → DLQ; admin redrive endpoints for both DLQ tables (Phase 10).
- Integration API: `/v1` sits behind `ApiKeyGuard` (org resolved from key, request runs as org's first app_user in `TenantContext.run` — fails closed); idempotency by DB unique constraint `(org_id, external_ref, kit_version_id)`, NOT by client keys; webhook fanout writes `webhook_delivery` rows in the same tx as the domain event, enqueues after commit.
- **react-router v7 + vitest jsdom gotcha:** data routers build `new Request(url, {signal})` on every navigation; undici rejects jsdom-realm AbortSignals → `navigate()` rejects silently and tests never change location. Fixed in `apps/candidate-web/src/test/setup.ts` by wrapping global `Request` to drop foreign signals. (Node 24 removed `AbortController`/`AbortSignal` from `node:stream/web`, so the usual global-swap fix no longer works.)
- **Mailpit prunes to 500 messages by default** (oldest first) — a live stack floods it and `waitForEmail` loses emails mid-poll. Compose sets `MP_MAX_MESSAGES=5000`; keep it whenever mailpit is recreated.
- **Stray host processes hold ports:** leftover `nest start --watch` / `node dist/main` dev instances (e.g. on :3100) can shadow servers you think you started — check `lsof -nP -iTCP:<port> -sTCP:LISTEN` and verify the PID/command before trusting an "already up" probe; `EADDRINUSE` in a backgrounded log is easy to miss.
- **Test-email traps:** `makeTestNamespace().email(tag)` generates a NEW random address per call — never call it twice for the same logical user (`signup(ns.email('admin'))` then `ns.email('admin')` are different inboxes). And `POST /v1/interviews` returns **201 on both create and idempotent replay** (replay = same `interview_id` + `idempotent_replay: true` + `invite_link: null`) — don't assert 200 on replay.
- **E2E tests the Docker image, not your working tree:** playwright configs use `reuseExistingServer: true` and compose owns :5173/:5174 — after any UI change you must `docker compose build <web> && up -d` before `pnpm e2e`, or you test a stale bundle.
- **Welcome grant keeps tests solvent:** every signup gets 100 `welcome_grant` credits in the signup transaction; balance-zero integration scenarios must `setBalance` explicitly after signup.
- LLM: only in NestJS gateway (`LlmProvider`: Mock always, Gemini when `LLM_MODE=gemini` + key; versioned prompt registry `services/api/prompts/<task>/vX.Y.Z.json`; mock fixture table throws on unknown task — new tasks need fixture + prompt + contract test). Python orchestrator has **no LLM port** — by design.
- Orchestrator contract: `POST /analysis/video` (JSON, pydantic) — see ARCHITECTURE.md §4; API client uses `node:http` with `ANALYSIS_HTTP_TIMEOUT_MS` (default 10 min) because undici's 300s default killed long videos.
- Integration tests must isolate queue names (`bootApp` uses per-boot UUID queues) — otherwise test workers steal live jobs (root-caused the orphaned-`pending` incident).
- Voice telemetry recording contract: top-level `{"recording": ref, "media_kind": "video"|"audio"}` (the old `{"turn":{"recording":...}}` nesting never fired — fixed).
- **Phase-12 gotchas (learned the hard way):**
  - `end` is a reserved word in Postgres — quote it (`"end"`) or the query dies; `practice_report_evidence_span.start`/`"end"` both need care.
  - Nest POST endpoints default to **201** — an endpoint the UI treats as an action (e.g. `/cand/resume/match`) needs `@HttpCode(200)`.
  - In Nest, a literal route (`@Get('progress')`) declared **below** `@Get(':id')` is shadowed by the param route — declare literals first or they 404/return the wrong shape.
  - `LlmGateway` task output field is **`parsed`**, not `output` — the mock fixture table enforces known task names, so a new task needs prompt JSON + fixture + contract test together or the gateway throws on boot.
- **Phase-12b gotchas (learned the hard way):**
  - `MediaRecorder` reports `blob.type` as `audio/webm;codecs=opus` (mimeType + codec suffix) — MIME allowlists must match the **bare type** (`split(';')[0]`) or every real browser upload 400s while unit tests pass.
  - Headless chromium needs `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (playwright `launchOptions.args`) or `getUserMedia` hangs forever with no error; with the fake device, MediaRecorder works fully — silence still produces a real webm.
  - The orchestrator mock STT returns its fixture transcript **even for invalid/silent audio** (fallback by design) — assert transcript non-emptiness only, never content.
  - **NUL-byte sniffing cannot classify files:** small PDFs are often NUL-free (decode as garbage text) and `.docx` zips can be NUL-free too. Decide content type by **file name** (`.pdf` → extraction port) and gate `.txt` behind a printable-character heuristic, never `buffer.includes(0)` alone.
  - `docker compose build ai-orchestrator` (linux/amd64 emulated on Apple Silicon) exceeds a 5-minute tool timeout — run it detached (`nohup … > /tmp/build.log 2>&1 &`) and poll the log; api/ascend-web builds fit in the cap.
  - After a **failed** image build, `docker compose up -d <svc>` silently keeps the old container — verify the fix landed inside the image (`docker compose exec <svc> grep -r … dist/`) before re-testing, or you debug stale code.
  - Avoiding a CreditsModule ↔ CandidateAccountsModule DI cycle: the alert service queries `candidate_account` with direct SQL instead of injecting the module.
  - Practice `advance()` never stamped `completed_at` until Branch 5 — any new status transition that business logic later filters on must set its timestamp explicitly in `updateStatus` extras.
  - `grant-credits.js` needs `DATABASE_URL` inline (55432) when run from a shell whose `.env` is stale.

## 6. MediaPipe / platform constraint

MediaPipe pinned **0.10.21** (1.0.1 SIGABRTs on macOS/arm64, no linux/aarch64 wheel) → numpy<2, orchestrator image is **linux/amd64-only**. On this ARM Mac the orchestrator runs emulated (150s clip ≈ 30 min; download 1.2s + audio 2.1s + the rest is landmarkers). On x86 (GCP VM, CI) it's native — expect ~realtime–2×. `.task`/`.onnx` models are downloaded at Docker build, pinned + sha256-verified; never committed.

## 7. Local environment gotchas (this machine)

- Foreign containers (promptwars-_, psychometric-ar-game-_) hold host ports **5432** and **5173** → zios Postgres is on **55432**, employer-web on **5273** (compose port overrides, `afed318`). Root `.env` DATABASE_URL still says 5432 — stale for host-run tests; use the 55432 URL inline.
- psychometric-ar-game-frontend was stopped once to free 5173 for E2E; restart that project's stack when needed.
- First OTP for a brand-new email can be rejected → hit **Resend** (known quirk).
- Toolchain on this machine: `nvm` (Node LTS jod v22.22.2, satisfies `>=22`); pnpm 11.1.1 via corepack, shim symlinked to `~/.local/bin/pnpm` so husky/commitlint works in any shell (verified 2026-09-22).
- hapkonic.com Cloudflare tunnel exists for LAN/remote access (livekit.hapkonic.com etc.) from earlier human-mode validation.

### 7.1 Native orchestrator dev loop (recommended on this ARM Mac)

The orchestrator container is `linux/amd64`-emulated here — a 150 s clip takes ~30 min. Native is ~realtime–2× and already proven: full 104-test suite passes in ~24 s via the project venv (MediaPipe 0.10.21 ships macOS/arm64 wheels; the missing wheel is linux/aarch64 only). Use **native for iteration, Docker as the pre-merge parity gate** (CI runs x86 compose; AGENTS.md §5/§6 still applies).

Infra stays in compose — only the orchestrator _process_ runs natively:

```bash
docker compose up -d            # infra: postgres(55432), redis, minio(9000/9001), livekit(7880), mailpit
docker compose stop ai-orchestrator   # free host port 8000
cd services/ai-orchestrator

# run the service natively, pointed at compose infra:
MINIO_ENDPOINT=localhost:9000 \
API_BASE_URL=http://localhost:3000 \
LIVEKIT_URL=ws://localhost:7880 \
STT_ADAPTER=${STT_ADAPTER:-mock} GCP_PROJECT_ID=${GCP_PROJECT_ID:-} \
uv run uvicorn app.main:app --reload --port 8000

# or just run the tests natively:
uv run pytest            # 104 passed / 2 skipped in ~25 s
```

Notes:

- MediaPipe/Silero models: Docker bakes them into `/opt/mediapipe-models`; natively `ensure_models` falls back to a per-user cache (downloaded once, same pins/sha256).
- ADC (GCP STT) is auto-discovered from `~/.config/gcloud` natively; in Docker it would need an explicit volume mount.
- Before merging anything, re-run the compose stack path (`docker compose up -d --build`) and its tests — native↔container diffs (model cache location, ffmpeg build) are exactly what the parity gate is for.

## 8. GCP deployment analysis (done, no code written)

Recommended: single **x86** `e2-standard-4` VM running compose unchanged; `VIDEO_ANALYSIS_FPS=3` to start; add coturn (TURN) for LiveKit; avoid ARM VMs (MediaPipe); scale later by isolating/replicating the orchestrator VM; GPU and Cloud Run/GKE deferred; managed vision APIs rejected (privacy + cost + provider-independence).

## 9. Known gaps (full table in docs/STATE.md §5)

- Live LiveKit capture proof pending (unit/integration only — owner signed off; verify on next real voice/video session: `recordings/*.webm` in MinIO + analysis completes).
- Real-provider validation pending (Gemini/GCP STT adapters ready; GCP STT validated live 2026-09-22; Gemini LLM adapter ready — wire keys when they arrive; TTS quality metrics unmeasurable on mocks).
- Ascend beta deferrals: voice-mode practice UI (text-only this drop), resume PDF/binary parsing (paste-text v1), real-LLM prompt evals (mock fixtures only) — all recorded in `docs/STATE.md` §5.
- Phase 11 not started (pilot hardening, notifications, Razorpay behind flag, load test → `v0.2.0-pilot`); owner review of `docs/partner-integration-runbook.md` + `docs/ascend-beta-runbook.md` pending; no WhatsApp/SMS; no real Google OAuth; no production infra.

## 10. Immediate next steps (docs/STATE.md §8)

1. **Phase 11 kickoff:** notifications (WhatsApp/SMS), Razorpay behind flag (credit top-ups for both products), pilot hardening + load test; tag `v0.2.0-pilot` after.
2. Owner review of `docs/partner-integration-runbook.md` + `docs/ascend-beta-runbook.md` + `docs/PRESENTATION.md`.
3. Live-capture proof on a real voice/AI-video session.
4. Ascend beta dry-run with a closed user cohort (readiness-formula feedback before the voice drop).
5. Provider procurement (LLM, TTS, Google OAuth, WhatsApp, payments).
6. Pilot prep: ≥3 pilot employers (PRD X9).

## 11. Working style notes (how this repo has been run)

- Heavy lifting delegated to coder subagents with pinned cross-service contracts; main agent verifies claims (DB queries, git, test counts) before reporting done.
- Docs are part of done: STATE.md refreshed at each milestone; phase checkboxes ticked only with evidence.
- Demo collateral: `docs/FEATURES.md` (catalog) + `docs/DEMO.md` (8-act script with fallbacks) — written for a live presentation.

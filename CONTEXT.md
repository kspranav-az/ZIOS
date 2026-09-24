# CONTEXT.md — ZIOS Working Context

**Last updated:** 2026-09-24 · **Branch:** `main` (Phase 12f follow-up merged 2026-09-24 via `phase-12f/piper-local-tts`, `--no-ff`; no new tag — follow-up on `phase-12-complete` + 12b/12c/12d/12e; `v0.2.0-pilot` intentionally waits for Phase 11) · **Remote:** `origin` = `git@github.com:kspranav-az/ZIOS.git` (SSH; all branches + tags pushed)

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

- **Phases 00–09 + 09b + 14 + 12 + 12b + 12c/12d + 12e + 12f complete.** Phase 10 (integration API + billing-lite) complete 2026-09-22, tagged `phase-10-complete` (partner loop validated over live HTTP; runbook `docs/partner-integration-runbook.md`; owner review of runbook pending). **Phase 12 (M2 Ascend) complete 2026-09-23, tagged `phase-12-complete`** — closed, grant-funded candidate practice beta: OTP candidate accounts + `CandidateAuthGuard` (audience-separated JWTs), practice engine on own tables (consent-gated X8, exact 1-credit live-transition debit, 3/day cap), judged reports with evidence-linked coaching tips, 4 LLM tasks (JD kit, resume parse, ATS check, resume-JD match with honesty guardrail), readiness formula `READINESS_FORMULA_V1` + progress/trend/streak, wallet ledger + candidate low-balance alerts, `apps/ascend-web` on :5175, ops runbook `docs/ascend-beta-runbook.md`. **Phase 12b (2026-09-23, follow-up merges on top of `phase-12-complete`, no new tag) closed both beta deferrals:** voice practice via record→transcribe→submit (`POST /cand/practice/:id/turn-audio` → MinIO → async-video `/video/transcribe` → editable transcript → turn carries `recordingRef`; exactly-2 debit) and resume PDF extraction (orchestrator `TextExtractorPort` + `POST /documents/extract-text`, pypdf via `DOCUMENT_EXTRACTION_ADAPTER`, Ascend `.pdf` file picker). Spec: `phases/phase-12b-voice-practice-pdf.md`. Phase 11 (notifications/hardening/pilot) is the only phase not started — it gates `v0.2.0-pilot`.
- **Phase 12e (2026-09-24, follow-up on 12c/12d, no new tag) closed three beta gaps:** (1) **live practice mode** — Ascend practice gains a third mode `live` (alongside text / voice-record): `POST /cand/practice/:id/live/token` proxies the orchestrator's voice-token router with a `practice` flag; the orchestrator runs a practice interviewer persona (pack/JD context, no proctoring/integrity/notify machinery) and posts turns back through the existing practice transcript write path so judging/report flow unchanged; Ascend `PracticeLivePage` reuses the new shared `packages/interview-room` package (extracted from candidate-web's Voice/Video pages — room lifecycle + media UI only, props-driven, no API/auth/env imports). (2) **Candidate interview history** — `candidate.candidate_account_id` link column (idempotent exact-email backfill, `lower()` match), lazy link upsert inside the read, `GET /cand/me/history` = `{practice, company}` read model (`reportAvailable` hardcoded `false` — candidate-side report sharing is a separate product decision), Ascend Progress page renders both sections. (3) **Responsiveness pinned** — 360px no-horizontal-overflow playwright smokes in all three apps. Spec: `phases/phase-12e-practice-live-history-responsive.md`.
- **Phase 12f (2026-09-24, follow-up on 12e, no new tag) — real local TTS:** Piper (VITS via ONNX Runtime + espeak-ng, CPU-only, no API key) implements `TtsPort` behind `TTS_ADAPTER=mock|piper` (factory mirrors `STT_ADAPTER`; boot-time fail-loud on unknown values; mock stays the CI/e2e default). The adapter loads the sha256-pinned MIT `en_US-lessac-medium` voice (baked into the image at `/opt/piper-models`, gitignored locally in `services/ai-orchestrator/models/`), buffers fragments into sentences exactly like the mock, synthesizes off the event loop, and resamples 22050→24000 Hz with soxr so the WS wire contract and all frontend playback stay untouched. Validated: host probe 7 chunks / 4.27 s / peak 32767, and the linux/amd64 image parity probe green. **Known gap recorded:** the voice room's STT is still constructed as `MockSttAdapter()` directly in `app/voice/router.py` — `STT_ADAPTER` does not apply to the live room yet (this is why real speech was fixture-transcribed in the 12e smoke). Spec: `phases/phase-12f-piper-local-tts.md`.
- **5 interview modes:** text (AI), voice (AI, LiveKit + text fallback), video (AI + proctoring baseline), human-facilitated (LiveKit cockpit, coverage tracking, scorecard), async video role-based (E15: create-by-role API, per-question recording → MinIO → transcription → review → AI pre-fill → human scorecard → report in live-mode schema; 3-credit debit, refund only before first answer).
- **Employer platform:** OTP auth (Mailpit), orgs + Admin/Interviewer roles, kit builder with immutable versions, JD→kit generation, question bank + `role_based_questions` (synced from external Neon DB — separate table, biweekly-ish upstream changes), invites (single/CSV, token links, OTP, reschedule, .ics), dashboard.
- **Evaluation:** evidence-linked reports, judge ensemble (2 parallel judges + adjudication), communication metrics, integrity panel, human overrides, PDF, share links.
- **Phase 10 — Integration API & credits wallet (E13/E14):** API keys (`zios_test_/zios_live_`, sha256-only, scopes, per-key rate limit, shown once); `/v1/interviews` idempotent create (unique `(org, external_ref, kit_version)`, replay returns same id + `idempotent_replay`, **201 on both first and replay**), status, scorecard v1 (`schema_version: "v1"`, shared evaluation read path); webhooks HMAC-signed (`X-Zios-Signature: t=…,v1=…`), journaled in `webhook_delivery` (dedupe via unique `(endpoint_id, session_event_id)`), backoff 1m/5m/30m/2h/12h ×5, admin replay; DLQ redrive endpoints (analysis + transcription, admin). Credits: pricing map kinds `{text:1, voice:2, video:3, human:1, async_video:3}` (`pricing.ts` — pricing kinds ≠ `InterviewMode`; human conductor prices flat); debit in the same tx as the live transition (downstream fault rolls back the charge = atomic refund); orchestrator voice-token failure refunds with `hasRefundForSession` dedupe; 100-credit `welcome_grant` at signup (keeps tests solvent); blocked-at-zero blocks new starts only (in-flight always finishes); low-balance email ≤1/24h per org (redis `lowbal:{orgId}` watermark, swallowed failures); wallet API + employer-web Wallet page; `scripts/grant-credits.js`. Partner-facing runbook + P95 SQL in `docs/partner-integration-runbook.md`.
- **Credits:** `credit_ledger` append-only; balance on `org.credits_balance`; insufficient → 402. ⚠️ `org` has **no `updated_at`** column — referencing it in credit queries silently breaks debit (learned the hard way).
- **Phase 14 — multimodal analysis (post-M1 extension):** generalized `analysis_job(kind, payload, status)` + `analysis_job_dlq`; BullMQ `analysis` queue; orchestrator `app/analysis/` — streaming ffmpeg preprocess (16kHz mono PCM; 5FPS/854px sequential frames), MediaPipe face/pose/hands (camera_gaze_ratio, solvePnP head pose, posture, gesture frequency, blur/quality), Silero VAD via onnxruntime (no torch), librosa pitch/energy over speech only, WPM/fillers/disfluency heuristics, temporal alignment + 3-level aggregation, pydantic schema (`Measurement{value,valid,reason,heuristic}` — no fake zeros), artifacts in MinIO `analysis/{sessionId}/{questionId|session}/*.json`, typed errors (2xx/4xx/5xx, never 200-with-fake). `STT_ADAPTER=mock|gcp` factory + `GoogleCloudSttAdapter` (Speech v2, word timestamps); mock is the default everywhere. Video-mode capture: hidden LiveKit recorder participant → webm → MinIO → telemetry → analysis. Employer review page has an objective-only features panel.

## 4. Test state (all green after Phase 12e merges, 2026-09-24)

- API: 377 passed / 2 skipped, 69 files (`pnpm --filter @zios/api test`; needs `DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos` inline — see §7); lint clean; typecheck clean except the known pre-existing TS1343 in `resume-intelligence.integration.spec.ts` (untouched by 12e, allowed by the phase file)
- Orchestrator: 131 passed / 2 skipped, ruff + mypy strict clean (`uv run pytest` etc. in `services/ai-orchestrator`) — incl. the Phase 12f Piper TTS contract suite (8 tests, skipped without the downloaded model)
- employer-web: 102 unit (tsc + lint clean), E2E **12 passed / 1 pre-existing failure** (`jd-generation.spec.ts` — deterministic: the mock proposal fixture returns 12 questions across 7 distinct topics and the review UI groups by topic, so 11 "Regenerate" buttons render vs 12 asserted; untouched by 12e per `git diff main...HEAD`, root cause identified, fix deferred) · candidate-web: 13 unit (tsc + lint clean, 2 pre-existing react-hooks warnings), **6/6 E2E** · ascend-web: 39 unit (tsc + lint clean, 1 react-hooks warning), **5/5 E2E** (text + voice + live-practice golden journeys, resume text + PDF, responsive smoke) · `packages/interview-room`: 9/9 — E2E re-run 2026-09-24 on freshly rebuilt compose images, all green
- Live validation: 150s clip (`test_video/interview_video_clip_test.mp4`) through full pipeline — plausible features (face 0.91, gaze 0.97, 135.9s speech / 14 pauses, pitch 235.8Hz); GCP STT validated live 2026-09-22 (Speech v2, 373 words / 150 s clip, word timestamps)
- Partner loop (FR-E13-5): full validation-layer cycle driven over live HTTP only (create → idempotent replay → candidate interview → completed → scorecard v1; wallet debited exactly 1 text credit) — evidence in `phases/phase-10-integration-api-billing.md` §Validation
- Validation scripts: `scripts/seed-{human,async-video,voice,video-proctoring,structured-answers,multimodal-analysis,integration-sandbox}-validation.js`, `scripts/grant-credits.js`, `scripts/sync-role-based-questions.js`

## 5. Key architecture decisions

- Job pattern: durable DB row in-transaction + BullMQ enqueue after commit; in-process workers; retries ×3 → DLQ; admin redrive endpoints for both DLQ tables (Phase 10).
- Integration API: `/v1` sits behind `ApiKeyGuard` (org resolved from key, request runs as org's first app_user in `TenantContext.run` — fails closed); idempotency by DB unique constraint `(org_id, external_ref, kit_version_id)`, NOT by client keys; webhook fanout writes `webhook_delivery` rows in the same tx as the domain event, enqueues after commit.
- **react-router v7 + vitest jsdom gotcha:** data routers build `new Request(url, {signal})` on every navigation; undici rejects jsdom-realm AbortSignals → `navigate()` rejects silently and tests never change location. Fixed in `apps/candidate-web/src/test/setup.ts` by wrapping global `Request` to drop foreign signals. (Node 24 removed `AbortController`/`AbortSignal` from `node:stream/web`, so the usual global-swap fix no longer works.)
- **Mailpit prunes to 500 messages by default** (oldest first) — a live stack floods it and `waitForEmail` loses emails mid-poll. Compose sets `MP_MAX_MESSAGES=5000`; keep it whenever mailpit is recreated.
- **Stray host processes hold ports:** leftover `nest start --watch` / `node dist/main` dev instances (e.g. on :3100) can shadow servers you think you started — check `lsof -nP -iTCP:<port> -sTCP:LISTEN` and verify the PID/command before trusting an "already up" probe; `EADDRINUSE` in a backgrounded log is easy to miss.
- **Stray processes also steal queue jobs (worse than port shadowing):** leftover `node dist/main` instances connect to the same Redis as BullMQ workers — they consume live queue jobs with their stale env and fail them (2026-09-23 incident: `analysis_job` rows failing with `ORCHESTRATOR_UNREACHABLE … ENOTFOUND ai-orchestrator` while the api container's env was provably correct; twin jobs completing 113ms later gave it away). Symptom to remember: **env-correct container + impossible hostname in job errors = another worker process somewhere.** Check `ps aux | grep "dist/main"` and Redis `bull:<queue>:*` consumers, not just the container.
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
- **Phase-12c gotchas (learned the hard way):**  - **LLM mock-race (root cause of "Questions from JD not working" in gemini mode):** the mock provider declared a higher `costPer1kOutput` than gemini flash, so the balanced tier's cost-descending order put mock first and gemini was never called — the UI got 201 with deterministic fixture junk in ~34 ms, no error anywhere. Fix: providers declare `fabricated` and the gateway never implicitly selects a fabricated provider while a real one is registered (`LLM_MODE=gemini` failures now surface as 503 `LLM_UNAVAILABLE`). Standing check before any gemini demo: `POST /generation/analyze` must take >~300 ms and return a profile **without** `raw.titleSource`; ~34 ms + `raw.*` = mock answered, routing regressed. Full matrix: `docs/ai-wiring-matrix.md`.
  - **E2E/CI runs use `LLM_MODE=mock`** (hermetic, deterministic). Gemini mode is real-provider mode — never run the e2e suites against it expecting deterministic output.
  - **`.env` duplicate variables are dangerous:** compose interpolation is last-wins but dotenv loading is first-wins — duplicate keys silently diverge between the container env and any dotenv consumer. Comment out the old value when adding a new one (we did this for the LiveKit dev → cloud switch).
  - **LiveKit Cloud is the active dev/validation SFU** (`wss://zios-hckwyqlv.livekit.cloud` in root `.env` + `.env.host`); the compose dev server (`ws://localhost:7880`) is the fallback. Standing check: a voice-token response's `livekit.url` must point at the cloud host.
  - Port-8000 clash trap: before starting the native orchestrator, `lsof -nP -iTCP:8000` — an env-less `uvicorn` left running answers health checks but lacks LiveKit/MinIO/STT env and fails sessions silently ( happened once; the detached start command lives in `services/ai-orchestrator/.env.host` workflow — `set -a; source .env.host` before `uv run uvicorn`).
- **Phase-12e gotchas (learned the hard way):**
  - **Port-8000 trap, second form — the stale-reload trap:** a *long-running* `uvicorn` started **without `--reload`** keeps serving the code as of its start time; health checks pass and it silently runs pre-feature code (the user's own 17:57 process predated the practice conductor; every symptom looked like a frontend bug). Always kill via `lsof -nP -iTCP:8000` and restart with `--reload`; check the process start time, not just its presence.
  - **Playwright `reuseExistingServer` + compose owns the dev ports** (second sting): when a spec needs *two* frontends (e.g. candidate-web's video journey opens an employer page on :5173), playwright's webServer only starts the suite's own app — the other frontend must be up as a container, or you get `ERR_CONNECTION_REFUSED` on a page unrelated to what you're changing. Multi-app specs need the full compose stack up.
  - **Grid/flex overflow pattern (the 12d/12e rule):** any `grid-cols-[…_1fr]` / growing flex child needs `min-w-0` on the fluid track or its card — children default to `min-width: auto` and blow the track past the viewport while `overflow-x-hidden` clips it (looked like "right side cut off"). Pinned app-wide by 360px `scrollWidth <= innerWidth` smokes in all three apps.
  - **citext vs node-pg parameter typing:** `lower(ca.email) = lower($2)` fails for camel-case params — node-pg types `$2` as `text`, and Postgres won't downcast `citext = text` case-insensitively; it becomes a case-sensitive comparison. Cast the parameter side: `lower(ca.email) = lower($2::citext)`.
  - **Module-cycle rule (ADR-0001 meets DI):** candidate-accounts → practice imports created a JS circular import that broke app boot silently. A read model that composes two modules gets its **own module** (`modules/history/`), importing both via their public `index.ts` only — lint enforces the boundary.
  - **Practice live mode needs the orchestrator process up** (same port-8000 rules as company voice/video): token endpoint 502s loudly by design if the orchestrator is unreachable — never fabricate a token.
  - **Pre-existing failure to not re-debug:** `employer-web/e2e/jd-generation.spec.ts` expects 12 "Regenerate this question" buttons but the mock fixture returns 12 questions over 7 distinct topics and the review UI groups by topic → 11 buttons. Deterministic on main, untouched by 12e; fix belongs to a generation-phase touch-up, not here.
- **Phase-12f gotchas (learned the hard way):**
  - **Piper's installed API ≠ its README:** piper-tts 1.8 removed `synthesize_stream_raw`; the live API is `synthesize(text) -> Iterable[AudioChunk]` with `audio_int16_bytes` / `sample_rate` per chunk. Always inspect the installed package (`inspect.signature` / `dir()`), never trust the docs.
  - **~~The voice room ignores `STT_ADAPTER`~~ (fixed 2026-09-24):** `app/voice/router.py` now builds the room STT from the same factory as the analysis pipeline (`STT_ADAPTER=mock` default keeps CI/e2e hermetic; host dev runs `gcp`). See "live-room wire contract" below.
  - **Piper rate ≠ wire rate:** lessac voices are 22050 Hz; the shared playback contract is 24000 Hz. The adapter resamples with soxr (`librosa`'s dependency) — do not change the frontend rate or the mock's 24000; resample at the adapter boundary.
  - **Model files are never committed:** `services/ai-orchestrator/models/` is gitignored; the image bakes the sha256-pinned copy. `PIPER_MODEL_PATH` overrides the location (set in `.env.host`, which is untracked).
  - **Per-word TTS synthesis sounds "high pitched":** the mock's `SENTENCE_RE` (`[^.!?]+[.!?]*`) matches a bare word mid-stream — harmless for silence fixtures, but a real TTS engine must buffer through a real terminator (`[^.!?]+[.!?]+`) and flush the remainder at stream end; isolated single words get rising, staccato intonation. Mock chunking semantics are a silence artifact, not a contract to copy.
  - **Nest's default JSON body limit is 100 kb:** any base64-audio endpoint (e.g. `POST /cand/practice/:id/turn-audio`) 413s with "request entity too large" on real recordings. `main.ts` sets `useBodyParser('json', { limit: '15mb' })` (app typed `NestExpressApplication` for it).
  - **Cache-first PWA shells go stale after every redeploy:** Ascend's sw.js was cache-first for all same-origin GETs and its content was deployment-invariant, so the SW never re-installed and served an old index.html referencing deleted hashed assets (blank page). Rule: shell/navigations network-first, content-hashed `/assets/` cache-first, nginx `no-cache` on `index.html`/`sw.js`. After any such fix, affected users must unregister the old SW once (DevTools → Application → Service Workers).
- **Field names are contracts — `audio_base64` was hex (the "high pitched sound", root-caused 2026-09-24):** the voice service sent `chunk.audio_bytes.hex()` in a field named `audio_base64`; the frontend ran `atob()` on it. Hex-of-silence base64-decodes to 100% non-zero garbage (`d3 4d 34…` repeating) = a harsh buzz that existed since the mock era and made Piper speech pure noise. Fix: producer sends real base64 (`base64.b64encode`), consumer untouched. Lesson: when a payload "plays" as garbage noise, suspect the encoding handshake before the audio pipeline — and the mock's zeros hid the lie for months because nobody asserts decoded content.
- **Live-room wire contract (multi-turn, GCP-STT era, 2026-09-24):**
  - The room socket is **multi-turn**: one `start_turn` per candidate answer, server replies per turn and then sends `awaiting_answer`; it sends `interview_complete` (then closes) when the conductor response carries `session.status == "completed"`. Audio arriving outside an active turn is pre-buffered into the next one; a `start_turn` arriving mid-turn is dropped.
  - **Mic contract:** hex **PCM16 mono 16 kHz** `audio_chunk` frames. The frontend (`interview-room/mic-capture.ts`) runs a dedicated 16 kHz AudioContext so the browser resamples the device stream; the GCP adapter's `transcribe_stream` hardcodes `sample_rate=16000` — never send device-rate PCM.
  - **GCP STT emits no partials** (it buffers the turn, then one `Recognize` call, capped at 60 s internally): live captions land at turn end, only the mock adapter streams `stt_partial`. Don't build UI that depends on room partials when `STT_ADAPTER=gcp`.
  - **`awaiting_answer` fires client-side only after queued TTS actually plays out** (`tts-player.ts` chains AudioBufferSources; `whenIdle` gates the mic). Otherwise the mic would capture the interviewer's own speech — classic echo/self-transcription bug.
  - First turn bootstrap: the page sends `start_turn` + `end_turn` with no audio; the conductor re-presents the current question (empty answer is a re-ask, not a recorded answer). Never fabricate a dummy transcript client-side.

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

- Live LiveKit capture proof pending (unit/integration only — owner signed off; verify on next real voice/video session: `recordings/*.webm` in MinIO + analysis completes). **Phase 12e narrows this gap by construction:** every live-practice run now exercises the same LiveKit capture path (orchestrator agent room) in e2e hermetically — what remains unproven is still real-network SFU/TURN media transport.
- Real-provider validation: Gemini LLM **validated live 2026-09-23** (JD analyze/propose in `LLM_MODE=gemini` against cloud key, real profiles; mock mode deterministic); GCP STT validated live 2026-09-22; **TTS: Piper local neural voice validated 2026-09-24 behind `TTS_ADAPTER=piper`** (host probe + linux/amd64 image parity probe) — cloud neural TTS (ElevenLabs-class) remains a procurement option, not a gap for pilot; real-LLM prompt evals still fixtures-only.
- Phase 11 not started (pilot hardening, notifications, Razorpay behind flag, load test → `v0.2.0-pilot`); owner review of `docs/partner-integration-runbook.md` + `docs/ascend-beta-runbook.md` pending; no WhatsApp/SMS; no real Google OAuth; no production infra.

## 10. Immediate next steps (docs/STATE.md §8)

1. **By-hand live smoke of the practice room, take three** (Piper TTS + GCP STT now live on the host orchestrator): expect intelligible interviewer speech, turn-end captions (no mid-speech partials — GCP STT is buffered), and a full multi-turn interview ending in `interview_complete` → report.
2. ~~**Wire the voice room STT to the adapter factory**~~ **(done 2026-09-24, branch `feat/live-room-gcp-stt`):** room STT is factory-driven (`STT_ADAPTER`), the frontend streams real 16 kHz mic audio, and the socket is multi-turn with `awaiting_answer`/`interview_complete`. Remaining room-STT caveat: GCP STT is buffered (no partials); streaming partials would need the GCP streaming API — a procurement-era nicety, not a gap.
3. **Phase 11 kickoff:** notifications (WhatsApp/SMS), Razorpay behind flag (credit top-ups for both products), pilot hardening + load test; tag `v0.2.0-pilot` after.
4. Owner review of `docs/partner-integration-runbook.md` + `docs/ascend-beta-runbook.md` + `docs/PRESENTATION.md`.
5. Live-capture proof on a real voice/AI-video session (see §9).
6. Ascend beta dry-run with a closed user cohort (readiness-formula feedback before the voice drop).
7. Provider procurement (LLM, cloud TTS if Piper quality is insufficient at scale, Google OAuth, WhatsApp, payments).
8. Pilot prep: ≥3 pilot employers (PRD X9).
9. Fix the pre-existing `jd-generation.spec.ts` expectation (topic-grouped regenerate buttons) next time generation code is touched.

## 11. Working style notes (how this repo has been run)

- Heavy lifting delegated to coder subagents with pinned cross-service contracts; main agent verifies claims (DB queries, git, test counts) before reporting done.
- Docs are part of done: STATE.md refreshed at each milestone; phase checkboxes ticked only with evidence.
- Demo collateral: `docs/FEATURES.md` (catalog) + `docs/DEMO.md` (8-act script with fallbacks) — written for a live presentation.

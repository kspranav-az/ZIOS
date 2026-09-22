# CONTEXT.md — ZIOS Working Context

**Last updated:** 2026-09-22 · **Branch:** `ai-analysis` (tip `494ef02`, tagged `phase-14-complete`) · **Unmerged into `main`:** `phase-09b/async-video-hardening` + `ai-analysis`

This file is the session-to-session handover: where the project is, how it runs, what's proven, what's pending, and the operational gotchas. Authoritative deep-dives live in `docs/` (`PRD`, `ARCHITECTURE.md`, `STATE.md`, `FEATURES.md`, `DEMO.md`) and `phases/`.

---

## 1. What this project is

ZIOS — an AI interview platform (ZeTheta). Monorepo (pnpm workspaces):

- `services/api` — NestJS modular monolith (strict TS), port `:3000`
- `services/ai-orchestrator` — Python 3.12 FastAPI (uv, ruff, mypy strict), port `:8000` — media/speech/analysis hot plane
- `apps/employer-web` (`:5173`, currently `:5273` — see §7) · `apps/candidate-web` (`:5174`) — React + Vite, TS only (`.tsx`, never `.jsx`)
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

- **Phases 00–09 + 09b + 14 complete.** Phase 10 (integration API + billing), 11 (notifications/hardening/pilot), 12/13 (M2/M3) not started.
- **5 interview modes:** text (AI), voice (AI, LiveKit + text fallback), video (AI + proctoring baseline), human-facilitated (LiveKit cockpit, coverage tracking, scorecard), async video role-based (E15: create-by-role API, per-question recording → MinIO → transcription → review → AI pre-fill → human scorecard → report in live-mode schema; 3-credit debit, refund only before first answer).
- **Employer platform:** OTP auth (Mailpit), orgs + Admin/Interviewer roles, kit builder with immutable versions, JD→kit generation, question bank + `role_based_questions` (synced from external Neon DB — separate table, biweekly-ish upstream changes), invites (single/CSV, token links, OTP, reschedule, .ics), dashboard.
- **Evaluation:** evidence-linked reports, judge ensemble (2 parallel judges + adjudication), communication metrics, integrity panel, human overrides, PDF, share links.
- **Credits:** `credit_ledger` append-only; balance on `org.credits_balance`; insufficient → 402. ⚠️ `org` has **no `updated_at`** column — referencing it in credit queries silently breaks debit (learned the hard way).
- **Phase 14 — multimodal analysis (post-M1 extension):** generalized `analysis_job(kind, payload, status)` + `analysis_job_dlq`; BullMQ `analysis` queue; orchestrator `app/analysis/` — streaming ffmpeg preprocess (16kHz mono PCM; 5FPS/854px sequential frames), MediaPipe face/pose/hands (camera_gaze_ratio, solvePnP head pose, posture, gesture frequency, blur/quality), Silero VAD via onnxruntime (no torch), librosa pitch/energy over speech only, WPM/fillers/disfluency heuristics, temporal alignment + 3-level aggregation, pydantic schema (`Measurement{value,valid,reason,heuristic}` — no fake zeros), artifacts in MinIO `analysis/{sessionId}/{questionId|session}/*.json`, typed errors (2xx/4xx/5xx, never 200-with-fake). `STT_ADAPTER=mock|gcp` factory + `GoogleCloudSttAdapter` (Speech v2, word timestamps); mock is the default everywhere. Video-mode capture: hidden LiveKit recorder participant → webm → MinIO → telemetry → analysis. Employer review page has an objective-only features panel.

## 4. Test state (all green at `phase-14-complete`)

- API: 271 passed / 48 files (`pnpm --filter @zios/api test`; needs `DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos` inline — see §7)
- Orchestrator: 104 passed / 2 skipped, ruff + mypy strict clean (`uv run pytest` etc. in `services/ai-orchestrator`)
- employer-web: 92 unit, 12/12 E2E · candidate-web: 13 unit, 5/5 E2E
- Live validation: 150s clip (`test_video/interview_video_clip_test.mp4`) through full pipeline — plausible features (face 0.91, gaze 0.97, 135.9s speech / 14 pauses, pitch 235.8Hz)
- Validation scripts: `scripts/seed-{human,async-video,voice,video-proctoring,structured-answers,multimodal-analysis}-validation.js`, `scripts/redrive-analysis-job.js`, `scripts/sync-role-based-questions.js`

## 5. Key architecture decisions

- Job pattern: durable DB row in-transaction + BullMQ enqueue after commit; in-process workers; retries ×3 → DLQ. No redrive endpoint yet (script exists).
- LLM: only in NestJS gateway (`LlmProvider`: Mock always, Gemini when `LLM_MODE=gemini` + key; versioned prompt registry `services/api/prompts/<task>/vX.Y.Z.json`; mock fixture table throws on unknown task — new tasks need fixture + prompt + contract test). Python orchestrator has **no LLM port** — by design.
- Orchestrator contract: `POST /analysis/video` (JSON, pydantic) — see ARCHITECTURE.md §4; API client uses `node:http` with `ANALYSIS_HTTP_TIMEOUT_MS` (default 10 min) because undici's 300s default killed long videos.
- Integration tests must isolate queue names (`bootApp` uses per-boot UUID queues) — otherwise test workers steal live jobs (root-caused the orphaned-`pending` incident).
- Voice telemetry recording contract: top-level `{"recording": ref, "media_kind": "video"|"audio"}` (the old `{"turn":{"recording":...}}` nesting never fired — fixed).

## 6. MediaPipe / platform constraint

MediaPipe pinned **0.10.21** (1.0.1 SIGABRTs on macOS/arm64, no linux/aarch64 wheel) → numpy<2, orchestrator image is **linux/amd64-only**. On this ARM Mac the orchestrator runs emulated (150s clip ≈ 30 min; download 1.2s + audio 2.1s + the rest is landmarkers). On x86 (GCP VM, CI) it's native — expect ~realtime–2×. `.task`/`.onnx` models are downloaded at Docker build, pinned + sha256-verified; never committed.

## 7. Local environment gotchas (this machine)

- Foreign containers (promptwars-_, psychometric-ar-game-_) hold host ports **5432** and **5173** → zios Postgres is on **55432**, employer-web on **5273** (compose port overrides, `afed318`). Root `.env` DATABASE_URL still says 5432 — stale for host-run tests; use the 55432 URL inline.
- psychometric-ar-game-frontend was stopped once to free 5173 for E2E; restart that project's stack when needed.
- First OTP for a brand-new email can be rejected → hit **Resend** (known quirk).
- hapkonic.com Cloudflare tunnel exists for LAN/remote access (livekit.hapkonic.com etc.) from earlier human-mode validation.

## 8. GCP deployment analysis (done, no code written)

Recommended: single **x86** `e2-standard-4` VM running compose unchanged; `VIDEO_ANALYSIS_FPS=3` to start; add coturn (TURN) for LiveKit; avoid ARM VMs (MediaPipe); scale later by isolating/replicating the orchestrator VM; GPU and Cloud Run/GKE deferred; managed vision APIs rejected (privacy + cost + provider-independence).

## 9. Known gaps (full table in docs/STATE.md §5)

- Live LiveKit capture proof pending (unit/integration only — owner signed off; verify on next real voice/video session: `recordings/*.webm` in MinIO + analysis completes).
- No DLQ redrive endpoint (both tables).
- Phases 09b + 14 unmerged to `main`.
- Real-provider validation pending (Gemini/GCP STT adapters ready; STT/TTS quality metrics unmeasurable on mocks).
- Phase 10/11 not started; no WhatsApp/SMS; no real Google OAuth; no production infra.

## 10. Immediate next steps (docs/STATE.md §8)

1. Squash-merge `phase-09b/*` then `ai-analysis` → `main`.
2. Live-capture proof on a real voice/AI-video session.
3. Phase 10 kickoff: `phase-10/*` — integration API (API keys, create-interview, webhooks) + credit wallet UI.
4. Provider procurement (LLM, STT, TTS, Google OAuth, WhatsApp, payments).
5. Pilot prep: ≥3 pilot employers (PRD X9).

## 11. Working style notes (how this repo has been run)

- Heavy lifting delegated to coder subagents with pinned cross-service contracts; main agent verifies claims (DB queries, git, test counts) before reporting done.
- Docs are part of done: STATE.md refreshed at each milestone; phase checkboxes ticked only with evidence.
- Demo collateral: `docs/FEATURES.md` (catalog) + `docs/DEMO.md` (8-act script with fallbacks) — written for a live presentation.

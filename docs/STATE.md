# State — InterviewOS / Meridian MVP

**Snapshot date:** 2026-09-22 · **HEAD:** `main` @ `0cebe90` (GCP STT real-provider fix merged 2026-09-22; all merges `--no-ff`, history preserved per owner) · **Remote:** `origin` = `git@github.com:kspranav-az/ZIOS.git` (all branches + tags pushed) · **Tags:** `phase-00-complete` … `phase-09b-complete`, `phase-14-complete`, `v0.1.0-mvp0-mock` · **Phase 10 in progress** — plan at `phases/phase-10-implementation-plan.md`

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

| Epic | Description               | Implemented?   | Notes                                                                                                                                                                                                     |
| ---- | ------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1   | Employer onboarding       | ✅             | Email OTP, org auto-creation, Admin/Interviewer roles; Google OAuth stubbed                                                                                                                               |
| E2   | Interview Kit Builder     | ✅             | CRUD, topics/questions, follow-up policy, timers, versioning, preview-as-candidate                                                                                                                        |
| E3   | JD-based generation       | ✅             | JD → proposal → review → publish; per-question regenerate; template gallery                                                                                                                               |
| E4   | Question sources          | ✅             | Seeded question bank + external adapter interface; provenance tracked; role-based question table added for async video                                                                                    |
| E5   | Scheduling & invites      | ✅             | Single + CSV bulk invites, token-bound links, candidate identity, optional OTP, reschedule-by-link, .ics for human mode                                                                                   |
| E6   | Candidate experience      | ✅             | Mobile-first web, preflight, consent, practice question, text/voice/video/async video, session recovery                                                                                                   |
| E7   | AI interviewer            | ✅             | Text + voice conductor; adaptive follow-ups behind mock LLM; timers; wrap-up                                                                                                                              |
| E8   | Human-facilitated mode    | ✅             | LiveKit room, slot scheduling, cockpit, coverage tracking, auto-notes, structured scorecard                                                                                                               |
| E9   | Proctoring (baseline)     | ✅             | Consent-gated snapshots, tab-switch/fullscreen-exit, copy-paste capture, integrity flags panel                                                                                                            |
| E10  | Evaluation & report       | ✅             | Transcript, rubric scores + evidence, communication metrics, integrity panel, override, PDF, share link                                                                                                   |
| E11  | Notifications             | ⚠️ Partial     | Email via Mailpit only; WhatsApp/SMS deferred to Phase 11                                                                                                                                                 |
| E12  | Dashboard (pipeline-lite) | ✅             | Interview list, statuses, kit stats, filters; async-video rows now route to review page instead of report                                                                                                 |
| E13  | Integration API           | 🚧 In progress | Phase 10 underway: DLQ redrive endpoints first, then API keys → `/v1/interviews` → webhooks → credits wallet; see `phases/phase-10-implementation-plan.md`                                                |
| E14  | Billing-lite              | ⚠️ Partial     | Credit ledger + 3-credit debit on async-video create + refund-before-first-answer wired and tested (Phase 09b); wallet UI and real payments remain Phase 10                                               |
| E15  | Async video interviews    | ✅             | Formal M1 mode as of PRD update; role-based creation, per-question recording, transcription, review, AI pre-fill + human scorecard, report, credit debit; see `phases/phase-09b-async-video-hardening.md` |

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
| No DLQ redrive endpoint                        | Stuck/dead analysis + transcription jobs need manual re-enqueue (`scripts/redrive-analysis-job.js` exists for analysis)                           | 🚧 Phase 10 Branch 0: Admin-gated redrive endpoints for both DLQ tables                                                                          |
| Orchestrator is `linux/amd64`-only             | mediapipe 1.0.1 crashes on macOS/arm64 and ships no linux/aarch64 wheel → pinned 0.10.21, emulated amd64 on ARM hosts (slow: 150 s clip ≈ 30 min) | Revisit when mediapipe ships aarch64; CI on x86 is native                                                                                        |
| `.env` DATABASE_URL stale (5432 vs 55432)      | Host-run tests/scripts fail against compose Postgres on 55432                                                                                     | Reconcile `.env` with compose port override                                                                                                      |
| Phase 10 not started                           | No integration API, webhooks, or credit wallet UI                                                                                                 | 🚧 In progress — see `phases/phase-10-implementation-plan.md`                                                                                    |
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

1. **Phase 10 execution:** Branches in order — `phase-10/dlq-redrive` → `api-keys-v1` → `interviews-endpoints` → `webhooks` → `credits-wallet` → final verification + `phase-10-complete` tag (not `v0.2.0-pilot`; that's post-Phase-11).
2. **Live capture proof:** run one real voice/AI-video browser session; verify `recordings/*.webm` in MinIO + analysis completion (closes the last known Phase-14 gap).
3. **Provider procurement:** Select and obtain credentials for LLM, STT, TTS, Google OAuth, WhatsApp, and payments.
4. **Key handover re-run:** Re-execute credential-gated phase validations with real providers.
5. **Pilot preparation:** Identify ≥ 3 pilot employers per PRD exit criterion X9.

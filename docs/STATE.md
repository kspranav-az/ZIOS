# State — InterviewOS / Meridian MVP

**Snapshot date:** 2026-09-12 · **HEAD:** `33bb89c` on `phase-09b/async-video-hardening` (6 commits ahead of `main`, awaiting squash-merge) · **Tags:** `phase-00-complete` … `phase-09b-complete`, `v0.1.0-mvp0-mock`

This file records the current implementation state, what is proven, what is not, and where the blockers are.

---

## 1. Build status

| Check                  | Result                    | Command                                 |
| ---------------------- | ------------------------- | --------------------------------------- |
| API unit + integration | ✅ 228 passed / 2 skipped | `pnpm --filter @zios/api test`          |
| Employer typecheck     | ✅ Clean                  | `pnpm --filter employer-web typecheck`  |
| Employer lint          | ✅ Clean                  | `pnpm --filter employer-web lint`       |
| Candidate typecheck    | ✅ Clean                  | `pnpm --filter candidate-web typecheck` |
| Candidate lint         | ✅ Clean                  | `pnpm --filter candidate-web lint`      |
| Employer E2E           | ✅ 12 passed              | `pnpm --filter employer-web e2e`        |
| Candidate E2E          | ✅ 5 passed               | `pnpm --filter candidate-web e2e`       |
| Docker Compose         | ✅ All healthy            | `docker compose up -d --build`          |

---

## 2. Feature completion by PRD epic

| Epic | Description               | Implemented? | Notes                                                                                                                                                                                                     |
| ---- | ------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1   | Employer onboarding       | ✅           | Email OTP, org auto-creation, Admin/Interviewer roles; Google OAuth stubbed                                                                                                                               |
| E2   | Interview Kit Builder     | ✅           | CRUD, topics/questions, follow-up policy, timers, versioning, preview-as-candidate                                                                                                                        |
| E3   | JD-based generation       | ✅           | JD → proposal → review → publish; per-question regenerate; template gallery                                                                                                                               |
| E4   | Question sources          | ✅           | Seeded question bank + external adapter interface; provenance tracked; role-based question table added for async video                                                                                    |
| E5   | Scheduling & invites      | ✅           | Single + CSV bulk invites, token-bound links, candidate identity, optional OTP, reschedule-by-link, .ics for human mode                                                                                   |
| E6   | Candidate experience      | ✅           | Mobile-first web, preflight, consent, practice question, text/voice/video/async video, session recovery                                                                                                   |
| E7   | AI interviewer            | ✅           | Text + voice conductor; adaptive follow-ups behind mock LLM; timers; wrap-up                                                                                                                              |
| E8   | Human-facilitated mode    | ✅           | LiveKit room, slot scheduling, cockpit, coverage tracking, auto-notes, structured scorecard                                                                                                               |
| E9   | Proctoring (baseline)     | ✅           | Consent-gated snapshots, tab-switch/fullscreen-exit, copy-paste capture, integrity flags panel                                                                                                            |
| E10  | Evaluation & report       | ✅           | Transcript, rubric scores + evidence, communication metrics, integrity panel, override, PDF, share link                                                                                                   |
| E11  | Notifications             | ⚠️ Partial   | Email via Mailpit only; WhatsApp/SMS deferred to Phase 11                                                                                                                                                 |
| E12  | Dashboard (pipeline-lite) | ✅           | Interview list, statuses, kit stats, filters; async-video rows now route to review page instead of report                                                                                                 |
| E13  | Integration API           | ❌           | Phase 10 scope; API keys, create-interview, webhooks not started                                                                                                                                          |
| E14  | Billing-lite              | ⚠️ Partial   | Credit ledger + 3-credit debit on async-video create + refund-before-first-answer wired and tested (Phase 09b); wallet UI and real payments remain Phase 10                                               |
| E15  | Async video interviews    | ✅           | Formal M1 mode as of PRD update; role-based creation, per-question recording, transcription, review, AI pre-fill + human scorecard, report, credit debit; see `phases/phase-09b-async-video-hardening.md` |

> Async video was originally added as a validation-layer shortcut. It is now **E15 in the PRD §3.4 IN list** with formal acceptance criteria and a scope trade (FR-E10-5 candidate comparison view deferred to M2).

---

## 3. Mock-credential mode inventory

Everything below is **fixture-driven mock** today. Feature code is complete; real adapter plugs into the same port.

| Capability                         | Port / adapter                                         | Mock behavior                                                                                                                                                  | Real handover item                                   |
| ---------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| LLM (generation, conductor, judge) | `LlmProvider` → `MockLlmProvider`, `GeminiLlmProvider` | Deterministic fixtures for JD analysis, follow-ups, scores; Gemini adapter (gemini-3.5-flash-lite default) with versioned prompt registry + `MOCK_MODE` toggle | Prompt tuning + cost validation against real traffic |
| STT                                | Orchestrator contract → `MockSttAdapter`               | Scripted transcript fixtures                                                                                                                                   | Deepgram/AssemblyAI + WER measurement                |
| TTS                                | Orchestrator contract → `MockTtsAdapter`               | Pre-recorded audio fixtures                                                                                                                                    | ElevenLabs/PlayHT + latency measurement              |
| Google OAuth                       | `OAuthPort` → `MockOAuthAdapter`                       | Accepts any `code` and returns deterministic profile                                                                                                           | Real Google OAuth app + verification                 |
| Email                              | `EmailSender` → `MailpitAdapter`                       | Sends via local SMTP                                                                                                                                           | Production SMTP/SES + deliverability                 |
| Storage                            | `S3Client` → `MinIOAdapter`                            | Local S3-compatible buckets                                                                                                                                    | AWS S3/GCS + lifecycle policies                      |
| Media                              | LiveKit self-hosted                                    | Real WebRTC rooms, dev keys                                                                                                                                    | LiveKit Cloud/managed cluster + TURN                 |
| Payments                           | Wallet schema stub                                     | Manual ledger only                                                                                                                                             | Razorpay KYC + payment port                          |
| WhatsApp/SMS                       | —                                                      | Not implemented                                                                                                                                                | Twilio/WhatsApp Business approval                    |
| Async video transcription          | `AsyncVideoTranscriptionService` → `SttPort`           | ffmpeg audio extraction + mock STT; BullMQ worker with 3 retries + DLQ                                                                                         | Real STT adapter only; worker infra is ready         |

---

## 4. Test evidence by phase

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

| Gap                                            | Why it matters                                                     | Next action                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Phase 09b branch not merged                    | `phase-09b/async-video-hardening` is 6 commits ahead of `main`     | Squash-merge to `main` after CI green, then re-tag state                            |
| Phase 10 not started                           | No integration API, webhooks, or credit wallet UI                  | Decide scope and start `phase-10/*`                                                 |
| Phase 11 not started                           | No pilot hardening, load test, or notifications                    | Start after Phase 10                                                                |
| No real LLM/STT/TTS validation                 | X2, X6, X7, WER cannot be measured                                 | Wire real adapters when credentials arrive (Gemini adapter + prompt registry ready) |
| No real Google sign-in                         | FR-E1-1 not fully validated                                        | Add real Google OAuth app                                                           |
| No WhatsApp/SMS                                | E11 partial                                                        | File template approvals (already noted as Week-1 exception)                         |
| No production infra                            | Cannot deploy outside Docker Compose                               | Define k8s/managed infra post-M1                                                    |
| Human-facilitated video stability under stress | LiveKit rooms work locally; multi-participant + TURN not validated | Re-test after Cloud TURN + run load scenario                                        |

---

## 6. Database state

All migrations through Phase 09b are applied in the compose stack. Key tables:

- Identity: `org`, `app_user`, `org_invite`, `session`
- Kit: `kit`, `kit_question`, `kit_version`, `question_bank_item`
- Interview: `invite`, `candidate`, `interview_session`, `session_transcript`, `consent`
- Evaluation: `evaluation_report`, `evaluation_score`, `evidence_span`, `score_override`, `interview_notes`
- Human-facilitated: `interview_slot`, `session_coverage`
- Integrity: `integrity_flag`, `integrity_snapshot`
- Generation: `jd_generation`
- Async video: `role_based_questions`, `async_video_review_score`, `transcription_job`, `transcription_job_dlq`, `credit_ledger`
- Infra: `evaluation_pipeline_log`, `preview_token`

Run `pnpm migrate` to verify no pending migrations.

---

## 7. Git hygiene

- **Branches:** All `phase-NN/*` branches are preserved locally. Every file on every branch tip up to Phase 09 is present in `main`; `phase-09b/async-video-hardening` is the active branch, 6 commits ahead of `main`, tagged `phase-09b-complete`.
- **Main:** Linear history of phase squash commits plus async-video fixes; tags `phase-00-complete` … `phase-09-complete` and `v0.1.0-mvp0-mock`.
- **Working tree:** Clean on `phase-09b/async-video-hardening` at snapshot time.

---

## 8. Immediate next steps

1. **Merge Phase 09b:** Squash-merge `phase-09b/async-video-hardening` to `main` after CI green.
2. **Phase 10 kickoff:** Create `phase-10/*` branch for integration API, webhooks, and credit wallet UI.
3. **Provider procurement:** Select and obtain credentials for LLM, STT, TTS, Google OAuth, WhatsApp, and payments.
4. **Key handover re-run:** Re-execute credential-gated phase validations with real providers.
5. **Pilot preparation:** Identify ≥ 3 pilot employers per PRD exit criterion X9.

# State — InterviewOS / Meridian MVP

**Snapshot date:** 2026-07-17 · **HEAD:** `dd00b17` (`feat(phase-09): human-facilitated interviews with cockpit and scorecard`) · **Tag:** `phase-09-complete`, `v0.1.0-mvp0-mock`

This file records the current implementation state, what is proven, what is not, and where the blockers are.

---

## 1. Build status

| Check                  | Result                   | Command                                 |
| ---------------------- | ------------------------ | --------------------------------------- |
| API unit + integration | ✅ 201 passed / 35 files | `pnpm --filter @zios/api test`          |
| Employer typecheck     | ✅ Clean                 | `pnpm --filter employer-web typecheck`  |
| Employer lint          | ✅ Clean                 | `pnpm --filter employer-web lint`       |
| Candidate typecheck    | ✅ Clean                 | `pnpm --filter candidate-web typecheck` |
| Candidate lint         | ✅ Clean                 | `pnpm --filter candidate-web lint`      |
| Employer E2E           | ✅ 11 passed             | `pnpm --filter employer-web e2e`        |
| Candidate E2E          | ✅ 4 passed              | `pnpm --filter candidate-web e2e`       |
| Docker Compose         | ✅ All healthy           | `docker compose up -d --build`          |

---

## 2. Feature completion by PRD epic

| Epic | Description               | Implemented? | Notes                                                                                                                   |
| ---- | ------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| E1   | Employer onboarding       | ✅           | Email OTP, org auto-creation, Admin/Interviewer roles; Google OAuth stubbed                                             |
| E2   | Interview Kit Builder     | ✅           | CRUD, topics/questions, follow-up policy, timers, versioning, preview-as-candidate                                      |
| E3   | JD-based generation       | ✅           | JD → proposal → review → publish; per-question regenerate; template gallery                                             |
| E4   | Question sources          | ✅           | Seeded question bank + external adapter interface; provenance tracked                                                   |
| E5   | Scheduling & invites      | ✅           | Single + CSV bulk invites, token-bound links, candidate identity, optional OTP, reschedule-by-link, .ics for human mode |
| E6   | Candidate experience      | ✅           | Mobile-first web, preflight, consent, practice question, text/voice/video, session recovery                             |
| E7   | AI interviewer            | ✅           | Text + voice conductor; adaptive follow-ups behind mock LLM; timers; wrap-up                                            |
| E8   | Human-facilitated mode    | ✅           | LiveKit room, slot scheduling, cockpit, coverage tracking, auto-notes, structured scorecard                             |
| E9   | Proctoring (baseline)     | ✅           | Consent-gated snapshots, tab-switch/fullscreen-exit, copy-paste capture, integrity flags panel                          |
| E10  | Evaluation & report       | ✅           | Transcript, rubric scores + evidence, communication metrics, integrity panel, override, PDF, share link                 |
| E11  | Notifications             | ⚠️ Partial   | Email via Mailpit only; WhatsApp/SMS deferred to Phase 11                                                               |
| E12  | Dashboard (pipeline-lite) | ✅           | Interview list, statuses, kit stats, filters                                                                            |
| E13  | Integration API           | ❌           | Phase 10 scope; API keys, create-interview, webhooks not started                                                        |
| E14  | Billing-lite              | ❌           | Phase 10 scope; wallet/credits not started                                                                              |

---

## 3. Mock-credential mode inventory

Everything below is **fixture-driven mock** today. Feature code is complete; real adapter plugs into the same port.

| Capability                         | Port / adapter                           | Mock behavior                                              | Real handover item                              |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| LLM (generation, conductor, judge) | `LlmProvider` → `MockLlmProvider`        | Deterministic fixtures for JD analysis, follow-ups, scores | Real provider + prompt tuning + cost validation |
| STT                                | Orchestrator contract → `MockSttAdapter` | Scripted transcript fixtures                               | Deepgram/AssemblyAI + WER measurement           |
| TTS                                | Orchestrator contract → `MockTtsAdapter` | Pre-recorded audio fixtures                                | ElevenLabs/PlayHT + latency measurement         |
| Google OAuth                       | `OAuthPort` → `MockOAuthAdapter`         | Accepts any `code` and returns deterministic profile       | Real Google OAuth app + verification            |
| Email                              | `EmailSender` → `MailpitAdapter`         | Sends via local SMTP                                       | Production SMTP/SES + deliverability            |
| Storage                            | `S3Client` → `MinIOAdapter`              | Local S3-compatible buckets                                | AWS S3/GCS + lifecycle policies                 |
| Media                              | LiveKit self-hosted                      | Real WebRTC rooms, dev keys                                | LiveKit Cloud/managed cluster + TURN            |
| Payments                           | Wallet schema stub                       | Manual ledger only                                         | Razorpay KYC + payment port                     |
| WhatsApp/SMS                       | —                                        | Not implemented                                            | Twilio/WhatsApp Business approval               |

---

## 4. Test evidence by phase

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

| Gap                                       | Why it matters                                  | Next action                                                 |
| ----------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| Phase 10 not started                      | No integration API, webhooks, or credit wallet  | Decide scope and start `phase-10/*`                         |
| Phase 11 not started                      | No pilot hardening, load test, or notifications | Start after Phase 10                                        |
| No real LLM/STT/TTS validation            | X2, X6, X7, WER cannot be measured              | Wire real adapters when credentials arrive                  |
| No real Google sign-in                    | FR-E1-1 not fully validated                     | Add real Google OAuth app                                   |
| No WhatsApp/SMS                           | E11 partial                                     | File template approvals (already noted as Week-1 exception) |
| No production infra                       | Cannot deploy outside Docker Compose            | Define k8s/managed infra post-M1                            |
| No usability review for cockpit/scorecard | Validation persona P-D unproven                 | Run a real interviewer walkthrough                          |

---

## 6. Database state

All migrations through Phase 09 are applied in the compose stack. Key tables:

- Identity: `org`, `app_user`, `org_invite`, `session`
- Kit: `kit`, `kit_question`, `kit_version`, `question_bank_item`
- Interview: `invite`, `candidate`, `interview_session`, `session_transcript`, `consent`
- Evaluation: `evaluation_report`, `evaluation_score`, `evidence_span`, `score_override`, `interview_notes`
- Human-facilitated: `interview_slot`, `session_coverage`
- Integrity: `integrity_flag`, `integrity_snapshot`
- Generation: `jd_generation`
- Infra: `evaluation_pipeline_log`, `preview_token`

Run `pnpm migrate` to verify no pending migrations.

---

## 7. Git hygiene

- **Branches:** All `phase-NN/*` branches are preserved locally. Every file on every branch tip is present in `main`; no dangling content.
- **Main:** Linear history of phase squash commits; tags `phase-00-complete` … `phase-09-complete` and `v0.1.0-mvp0-mock`.
- **Working tree:** Clean on `main` at snapshot time.

---

## 8. Immediate next steps

1. **Human validation:** Walk a real interviewer through the cockpit and scorecard (persona P-D).
2. **Phase 10 kickoff:** Create `phase-10/*` branch for integration API, webhooks, and wallet.
3. **Provider procurement:** Select and obtain credentials for LLM, STT, TTS, Google OAuth, WhatsApp, and payments.
4. **Key handover re-run:** Re-execute credential-gated phase validations with real providers.
5. **Pilot preparation:** Identify ≥ 3 pilot employers per PRD exit criterion X9.

# Executive Summary — InterviewOS / Meridian MVP

**Date:** 2026-07-17 · **Milestone:** M1 (Employer Interview Platform) · **Current status:** Phases 00–09 complete, Phase 10/11 not started

---

## 1. What we built

An employer interview platform where a recruiter can:

1. Sign up and create a workspace (email OTP; Google OAuth stubbed).
2. Build an interview kit manually or generate one from a JD.
3. Publish an immutable kit version and send candidates magic links.
4. Run AI-conducted text, voice, or video interviews with baseline proctoring.
5. Run human-facilitated live interviews with an interviewer cockpit, auto-notes, and structured scorecard.
6. Receive evidence-linked evaluation reports with per-criterion scores, transcript evidence, integrity flags, and human override.

The platform runs end-to-end locally in Docker Compose with **zero real third-party credentials**. All credential-gated providers (LLM, STT/TTS, Google OAuth, WhatsApp, payments) are behind fixture-driven mock adapters.

---

## 2. Milestone status

| Phase | Scope                                 | Status         | Evidence                                                                 |
| ----- | ------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| 00    | Engineering foundation                | ✅ Complete    | CI, compose, migrations, conventions                                     |
| 01    | Identity, orgs & design system        | ✅ Complete    | Email OTP signup, org provisioning, `@zios/ui`                           |
| 02    | Kit builder & question bank           | ✅ Complete    | CRUD, versioning, publish, preview, seeded bank                          |
| 03    | Invites & candidate text interview    | ✅ Complete    | Magic links, consent, text mode, recovery                                |
| 04    | Evaluation, report & dashboard        | ✅ Complete    | Evidence-linked scoring, overrides, PDF, share links, pipeline dashboard |
| 05    | JD-based generation                   | ✅ Complete    | JD → proposal → review → publish                                         |
| 06    | LLM gateway & real AI (mock)          | ✅ Complete    | Routing, fallback, budgets, guardrails, mock OAuth                       |
| 07    | Voice mode (mock STT/TTS)             | ✅ Complete    | LiveKit room, turn orchestration, fallback to text                       |
| 08    | Video & baseline proctoring           | ✅ Complete    | Webcam snapshots, tab-switch/copy-paste flags, human disposition         |
| 09    | Human-facilitated mode                | ✅ Complete    | Scheduling, cockpit, coverage, auto-notes, scorecard                     |
| 10    | Integration API, webhooks & wallet    | ⬜ Not started | E13, E14                                                                 |
| 11    | Notifications, hardening & pilot gate | ⬜ Not started | E11, X-criteria, load test, red-team                                     |

**Milestone tag:** `v0.1.0-mvp0-mock` (mock-credential MVP0).  
**Next target:** `v0.2.0-pilot` after Phase 11.

---

## 3. Validation evidence

Last full verification on `main` (commit `dd00b17`):

- **API tests:** 201 passed / 35 files
- **Employer E2E:** 11 passed (auth, kit builder, invites, JD generation, report dashboard, human-facilitated, screenshots)
- **Candidate E2E:** 4 passed (text, voice, video, recovery)
- **Typecheck:** `api`, `employer-web`, `candidate-web` clean
- **Lint:** `api`, `employer-web`, `candidate-web` clean
- **Docker Compose:** all services healthy

---

## 4. What is deliberately deferred (mock-credential mode)

| Deferred item              | Why                                              | When it lands                    |
| -------------------------- | ------------------------------------------------ | -------------------------------- |
| Real LLM provider          | No credentials; mock covers all feature paths    | Phase 10/11 or key handover      |
| Real STT/TTS               | No credentials; voice pipeline proven with mocks | Phase 10/11 or key handover      |
| Real Google OAuth          | Mock adapter implements callback contract        | Phase 06 re-run with credentials |
| WhatsApp/SMS notifications | Mailpit only for now                             | Phase 11                         |
| Razorpay payments          | Wallet schema exists; no payment port            | Phase 11                         |
| Advanced proctoring        | Gaze/deepfake/liveness need vendor evals         | M2                               |
| Production deployment      | Docker Compose is dev-only                       | Post-M1 infra work               |

Credential-gated validation items (e.g. real model generation quality, WER, voice latency, COGS) are explicitly **not validated** in this run and are listed in each phase file for re-run at key handover.

---

## 5. Key risks

1. **Provider quality unknown.** Mock adapters prove the plumbing, not the AI quality. Real LLM/STT/TTS could require prompt or pipeline changes.
2. **Cost economics unproven.** X7 (≤ ₹30 per 15-min voice interview) cannot be measured until real providers are wired.
3. **Pilot readiness gap.** Phases 10–11 (integration API, notifications, hardening, load test) are required before any real employer pilot.
4. **Human-facilitated UX.** The cockpit and scorecard are functional but have not had real interviewer usability feedback.
5. **Compliance surface.** Baseline consent and integrity flags are in place; DPDP/NYC LL144/EU AI Act export/audit tooling is not yet built.

---

## 6. Decisions needed

| Decision                                                    | Owner                 | Impact                                             |
| ----------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| Start Phase 10 (integration API + wallet) or Phase 11 first | Product/Engineering   | Phase 11 hardening depends on Phase 10 API surface |
| Real provider selection (LLM, STT, TTS)                     | Engineering + Finance | Unlocks real quality/cost validation               |
| Pilot employer selection                                    | Product               | Phase 11 exit gate requires ≥ 3 pilots             |
| Production infra target (k8s vs managed services)           | Engineering           | Blocks real deployment after M1                    |
| Phase 09 usability review with a real interviewer           | Product               | Validation checkbox P-D                            |

---

## 7. How to run it today

```bash
cp .env.example .env
pnpm install
docker compose up -d --build
pnpm migrate

# Verify
pnpm --filter @zios/api test
pnpm --filter employer-web e2e
pnpm --filter candidate-web e2e
```

Open `http://localhost:5173` (employer) or `http://localhost:5174` (candidate). No API keys required.

---

## 8. Related documents

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — implemented system design
- [`PROJECT.md`](./PROJECT.md) — repo layout, stack, setup
- [`STATE.md`](./STATE.md) — module-level implementation state
- [`phases/README.md`](../phases/README.md) — full phase plan and integration schedule

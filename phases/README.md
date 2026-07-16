# Phases — Implementation Plan

The executable build plan for the vision in `docs/`. Phases 00–11 deliver **M1 (Meridian MVP)** exactly as scoped in the PRD (epics E1–E14, exit criteria X1–X10); phases 12–13 are lightweight outlines of M2/M3 kept here only to keep the vision visible — they are re-planned in detail when M1 ships.

## How phases work

- **Sequential.** A phase starts only after the previous phase's exit gate passed and is tagged (`phase-NN-complete`). Within a phase, tasks land as small PRs on `phase-NN/<slug>` branches (see `AGENTS.md` §4).
- **Checkbox-driven.** Every phase file ends with two checklists — **Verification** (did we build it right: tests, CI, performance) and **Validation** (did we build the right thing: PRD acceptance criteria, X-metrics). A phase is done when every box is checked. Check boxes in the same PR that completes the work.
- **Gate-tagged.** Green checklists + exit gate ⇒ annotated git tag. Milestone tags: `v0.1.0-mvp0` after Phase 06, `v0.2.0-pilot` after Phase 11.

## Third-party integration schedule (deliberately late)

Early phases build against **ports (interfaces) + local stubs** so the entire product loop is testable in Docker before any real provider is wired. Integrations land only in their scheduled phase:

| Provider / integration | Phase | Stub used before |
|---|---|---|
| Email (SMTP) | 00 (Mailpit, local) | — |
| S3 storage | 00 (MinIO, local) | — |
| LLM (generation, conductor, judges) | **06** | deterministic stub adapter |
| Google OAuth | **06** | email+OTP via Mailpit |
| LiveKit media | 00 dev server → real rooms in **07** | dev server |
| STT / TTS | **07** | text-only mode |
| WhatsApp Business / SMS | **11** | email via Mailpit |
| Razorpay payments | **11** (behind flag; pilots use manual credit grants) | manual ledger |
| Candidate phone OTP (SMS) | **11** | email OTP via Mailpit |

> Week-1 ops exception (PRD §13 lead-time items): WhatsApp template approval and Razorpay KYC **applications** are filed in Phase 00 — paperwork early, code late.

## Phase index

| # | Phase | PRD coverage | Gate |
|---|---|---|---|
| 00 | [Engineering foundation](phase-00-foundation.md) | infra, CI/CD, conventions, lead-time applications | Repo + CI + compose green |

> **Execution mode — mock-credential run (phases 00–09):** this run executes with
> fixture-driven mock adapters for the credential-gated providers (`MockLlmAdapter`,
> `MockSttAdapter`, `MockTtsAdapter`, `MockOAuthAdapter`) behind the same ports and
> contract suites. LiveKit is self-hosted locally, so media transport is real.
> **Credential-gated items deferred to key handover (NOT validated in this run):**
> X2 real generation quality · FR-E7-2 follow-up relevance ≥ 90% with a real model ·
> judge-agreement economics · X6 real voice latency · X7 real COGS · Hinglish WER ·
> real Google sign-in (FR-E1-1) · voice naturalness panel. Each affected phase file
> lists its deferred items; the MVP-0 tag is recorded as `v0.1.0-mvp0-mock` and the
> real AI/pilot gates re-run when credentials arrive.
| 01 | [Identity, orgs & design system](phase-01-identity-orgs-design-system.md) | E1 | Signup → workspace ≤ 2 min |
| 02 | [Interview Kit Builder & question bank](phase-02-kit-builder-question-bank.md) | E2, E4-1/4-3 | Kit CRUD → publish end-to-end |
| 03 | [Invites & candidate text interview](phase-03-invites-candidate-text-interview.md) | E5, E6, E7 (text, stub AI) | Link → consent → text interview → recovery |
| 04 | [Evaluation, report & dashboard](phase-04-evaluation-report-dashboard.md) | E10 (stub judges), E12 | Transcript → evidence-linked report |
| 05 | [JD-based generation](phase-05-jd-generation.md) | E3, E4-2 | JD → kit proposal → review → publish (stub) |
| 06 | [LLM gateway & real AI](phase-06-llm-gateway-real-ai.md) | E3/E7/E10 real, FR-E1-1 Google | **MVP-0: JD → link → text interview → report, real AI** (`v0.1.0-mvp0`) |
| 07 | [Voice mode](phase-07-voice-mode.md) | E7 voice, E6 preflight/fallback | Voice interview on 4G, latency ≤ X6 |
| 08 | [Video mode & baseline proctoring](phase-08-video-proctoring.md) | E9 | Strict-level interview with flags on report |
| 09 | [Human-facilitated mode](phase-09-human-facilitated.md) | E8 | Live room → scorecard → report |
| 10 | [Integration API, webhooks & wallet](phase-10-integration-api-billing.md) | E13, E14 | Validation-layer loop closes programmatically |
| 11 | [Notifications, hardening & pilot gate](phase-11-notifications-hardening-pilot-gate.md) | E11, X-criteria dry-run, load test, red-team | **Pilot gate: X1–X8 verified** (`v0.2.0-pilot`) |
| 12 | [M2 outline — Ascend & depth](phase-12-m2-outline.md) | M2 epics (deferred) | re-planned after M1 |
| 13 | [M3 outline — Ecosystem](phase-13-m3-outline.md) | M3 epics (deferred) | re-planned after M2 |

## Mapping to the PRD's 10-week release plan (§15)

Phases are workload slices, not calendar weeks, but the correspondence is: W1–2 → 00–02 · W3–4 → 03–05 · W5–6 → 06–07 · W7 → 08 · W8 → 09 · W9 → 10 · W10 → 11. With a 1–2 engineer team, drop Phase 09 to manual-workaround per PRD §15 and extend the timeline.

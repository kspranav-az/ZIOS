# Phase 06 — LLM Gateway & Real AI (MVP-0 Gate)

**Status:** ⬜ Not started · **Depends on:** Phase 05 · **PRD refs:** E3/E7/E10 real paths, FR-E7-2, FR-E7-4, FR-E1-1 (Google), §15 W5–6 · **Milestone tag:** `v0.1.0-mvp0`

## Objective

Swap every stub for real AI behind a production-grade LLM gateway: JD generation, adaptive interview conductor (text mode), and the judge-ensemble evaluator — the first phase with real third-party AI, and the **MVP-0 gate: JD → link → text interview → evidence-linked report, all real**.

## Scope

**In**
- `LlmGateway` service: single internal API `llm.complete(task, payload, policy)`; **two live providers** with task-based routing (quality/latency/cost tiers), fallback chains, semantic + prefix caching, per-org/session budget ceilings with circuit breakers, journaled (PII-redacted) request/response log (Blueprint §10.2)
- Prompt registry: prompts as versioned artifacts (name, version, variables schema, guardrail profile); every artifact stamped `prompt@version`
- Real adapters: `LlmConductorAdapter` (adaptive follow-ups, depth-capped, references candidate's actual answer ≥ 90% on eval set — FR-E7-2), real JD generation (replaces Phase 05 stub), judge ensemble (two judges + higher-tier adjudication on disagreement — Blueprint §12.1)
- Guardrails: prompt-injection screening on candidate text, topic boundaries, answer-leakage refusal, structured-output schemas (FR-E7-4); initial red-team suite
- Eval harness v1 (offline golden sets): follow-up relevance, scoring agreement vs human raters, JD proposal quality — prompts ship only through an eval gate (CI)
- Cost attribution: per-session AI cost telemetry feeding the X7 dashboard
- Google OAuth adapter for employer sign-in (FR-E1-1 completes)

**Out**
- Voice-mode realtime LLM loop (Phase 07 — different latency/routing profile), self-hosted models (post-MVP)

## Deliverables

- Gateway + registry + real adapters live; stubs remain for tests/local dev via config
- X2 measured with real generation (≥ 70% proposals published with ≤ 3 edits — tracked, target confirmed at pilot)
- **Gate demo:** JD paste → generated kit → review → publish → invite → candidate text interview with adaptive AI follow-ups → evidence-linked report ≤ 5 min

## Technical approach & patterns

- Same-contract swap: `InterviewerAi`, `JudgePort`, generation pipeline consume the gateway unchanged from stub phases — ports-and-adapters pays off here
- Judge disagreement → adjudicator route; judge agreement target ~90% so adjudication stays cheap (Blueprint §10.8)
- Budgets: session exceeding ₹ ceiling degrades to cheaper route, never to an unbounded bill; cost is a CI-visible metric
- Contract tests run against both stub and real adapters (real gated to nightly CI with secrets)

## Third-party integrations allowed this phase

**LLM providers (2), Google OAuth.** Nothing else.

## Testing strategy

- Contract: stub vs real adapter parity on the shared suite
- Offline evals (golden sets): follow-up relevance ≥ 90% (FR-E7-2); scoring within-1 agreement ≥ 85% vs human raters (Blueprint §10.7 target); JD proposals reviewed for X2 quality
- Red-team suite: injection via candidate answers, JD-bombed prompts, PII bait (FR-E7-4)
- E2E: full MVP-0 journey with real providers (nightly + release candidate)

## Git plan

- `phase-06/llm-gateway`, `phase-06/prompt-registry`, `phase-06/conductor-adapter`, `phase-06/judge-ensemble`, `phase-06/eval-harness`, `phase-06/google-oauth`
- Tags: `phase-06-complete`, **`v0.1.0-mvp0`**

## Exit gate

MVP-0 demo green on staging with real AI, eval gates passing, cost telemetry live.

## Verification ✅

- [ ] Gateway routing/fallback/budget tests: provider kill → fallback serves; budget trip → degrade, never fail open
- [ ] Prompt registry: production completions all stamped `prompt@version`; unversioned prompt cannot deploy (CI gate)
- [ ] Follow-up relevance ≥ 90% on eval set; depth cap never exceeded (FR-E7-2)
- [ ] Judge ensemble: agreement rate + adjudication path logged; ungrounded scores still schema-rejected
- [ ] Red-team suite passes on the release candidate (FR-E7-4)
- [ ] Per-session AI cost attributed and visible on dashboard (X7 substrate); text-mode session cost within projection
- [ ] Google OAuth + email/OTP both work; account linking rules tested (FR-E1-1)

## Validation ✔️

- [ ] MVP-0 end-to-end demo recorded: JD → kit → link → interview → report (real AI, staging)
- [ ] Generated kits from real JDs reviewed by 2 humans: X2 quality bar plausibly ≥ 70% (final number measured at pilot)
- [ ] Report quality with real judges reviewed against stub-phase reports — evidence quotes remain specific and correct
- [ ] Cost per text interview within the modelled budget toward X7 (₹30/15-min voice equivalent)

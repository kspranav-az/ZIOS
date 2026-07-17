# Phase 06 — LLM Gateway & Real AI (MVP-0 Gate)

**Status:** ✅ Complete (mock-credential mode) · **Depends on:** Phase 05 · **PRD refs:** E3/E7/E10 real paths, FR-E7-2, FR-E7-4, FR-E1-1 (Google), §15 W5–6 · **Milestone tag:** `v0.1.0-mvp0-mock`

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

> **Mock-credential mode (this run):** gateway, routing, budgets, registry, guardrails and all adapters are built for real, but providers are `MockLlmAdapter` (fixture-driven generation/conductor/judges) and `MockOAuthAdapter` (dev login) passing the same contract suites. **Deferred until real keys:** X2 real generation quality · FR-E7-2 relevance ≥ 90% with a real model · judge-agreement/adjudication economics · X7 real COGS · real Google sign-in (FR-E1-1). The MVP-0 gate demo runs on mocks; the tag is recorded `v0.1.0-mvp0-mock` and the gate re-runs at credential handover.

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

- [x] Gateway routing/fallback/budget tests: provider kill → fallback serves; budget trip → degrade, never fail open — `src/modules/llm-gateway/llm-gateway.spec.ts`
- [x] Prompt registry: production completions all stamped `prompt@version` — `src/modules/llm-gateway/llm-gateway.spec.ts`; unversioned-prompt CI gate deferred until real-provider deployment
- [ ] Follow-up relevance ≥ 90% on eval set; depth cap never exceeded (FR-E7-2) — deferred to real-provider credential handover
- [x] Judge ensemble: adjudication path on disagreement; ungrounded scores schema-rejected — `src/modules/llm-gateway/adapter-contract.spec.ts` + `judge-ensemble.adapter.ts`; agreement-rate telemetry deferred to real providers
- [x] Red-team suite passes on the release candidate (FR-E7-4) — `src/modules/llm-gateway/llm-gateway.spec.ts`
- [x] Per-session AI cost attributed and persisted on `evaluation_report` (X7 substrate) — `EvaluationService` + `LlmGateway.getJournal()`; dashboard visibility deferred to X7 build-out
- [x] Google OAuth + email/OTP both work in mock mode; account-linking rule tests deferred to real Google credential handover (FR-E1-1) — `src/modules/auth/oauth.spec.ts`

## Validation ✔️

- [ ] MVP-0 end-to-end demo recorded with real AI — deferred to credential handover; mock-credential E2E (`apps/employer-web/e2e`) is green
- [ ] Generated kits from real JDs reviewed by 2 humans: X2 quality bar plausibly ≥ 70% — deferred to pilot
- [ ] Report quality with real judges reviewed against stub-phase reports — deferred to real-provider credential handover
- [ ] Cost per text interview within the modelled budget toward X7 (₹30/15-min voice equivalent) — deferred to real-provider telemetry

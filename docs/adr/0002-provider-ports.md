# ADR-0002: Provider ports and adapters (mock-credential mode)

**Status:** Accepted · **Date:** 2026-07-16 (Phase 00)

## Context

The product depends on many external capabilities — email, S3 storage, LLM
(generation/conductor/judges), STT/TTS, payments, OAuth, WhatsApp/SMS,
LiveKit media. AGENTS.md §3 forbids wiring real providers before their
scheduled phase, and the PRD requires provider independence: no feature code
may name a vendor. Phases 00–09 additionally run in **mock-credential mode**
(`phases/README.md`): credential-gated providers are exercised through
fixture-driven mock adapters behind the same ports and contract suites.

## Decision

Every external capability is a **port** (an interface declared in the module
that owns the capability) with at least a **local stub adapter**. Real
adapters arrive only in their scheduled phase and must slot in without
touching call sites:

| Capability     | Port (owner module)                    | Stub now                          | Real adapter           | Phase         |
| -------------- | -------------------------------------- | --------------------------------- | ---------------------- | ------------- |
| Email          | `EmailSender` (identity/notifications) | Mailpit (SMTP)                    | transactional provider | 00 local / 11 |
| Object storage | `ObjectStore` (media/artifacts)        | MinIO                             | S3-compatible          | 00 local      |
| LLM            | `LlmGateway` (ai-orchestrator)         | deterministic `MockLlmAdapter`    | vendor behind gateway  | 06            |
| OAuth          | `AuthProvider` (identity)              | email+OTP via Mailpit             | Google OAuth           | 06            |
| Media          | LiveKit port (session)                 | self-hosted dev server            | real rooms             | 00 dev / 07   |
| STT/TTS        | `SpeechToText`/`TextToSpeech` (speech) | `MockSttAdapter`/`MockTtsAdapter` | vendors                | 07            |
| WhatsApp/SMS   | `OtpSender`/`Notifier`                 | email via Mailpit                 | WhatsApp Business      | 11            |
| Payments       | `PaymentGateway` (wallet)              | manual credit ledger              | Razorpay (flagged)     | 11            |

Rules:

1. **Ports live with the consumer**, adapters behind them; feature code never
   imports an adapter directly — DI binds port → adapter per environment.
2. **Contract-test harness:** stub and real adapters of the same port must
   pass the same contract suite (pattern established now, exercised from
   Phase 06 onward).
3. **Mock-credential mode:** mocks are first-class adapters selected by
   config, not test doubles; the `v0.1.0-mvp0-mock` tag records that
   credential-gated validation items are deferred to key handover.
4. No vendor SDK or credential may appear in code, config, or CI before its
   phase — the repo secret scan must stay clean.

## Consequences

- The whole product loop is testable in Docker with zero real credentials.
- Adding a provider means: implement the port's adapter, pass the existing
  contract suite, bind it in config — no call-site changes.
- Mock fidelity becomes a risk item: deferred validations (X2, X6, X7,
  FR-E7-2 relevance, etc. — listed in `phases/README.md`) must be re-run when
  real credentials arrive.

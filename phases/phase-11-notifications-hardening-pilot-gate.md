# Phase 11 — Notifications, Hardening & Pilot Gate

**Status:** ⬜ Not started · **Depends on:** Phase 10 · **PRD refs:** E11 (FR-E11-1…E11-3), X1–X10, §13, §16, §15 W9–10 · **Milestone tag:** `v0.2.0-pilot`

## Objective

Wire the remaining real channels, harden the whole system, and prove the X-criteria on staging — the gate to onboarding the 3 pilot employers.

## Scope

**In**
- Notification service completion: template service with per-event toggles (invite, reminder, nudge-incomplete, completion, report-ready), delivery ≤ 1 min (FR-E11-1)
- Real channels: WhatsApp Business API (templates approved since Phase 00 application) + SMS fallback; consent-aware sending — candidate marketing opt-in separate from transactional, recorded in the consent registry (FR-E11-2, FR-E11-3)
- Candidate phone OTP via SMS (completes FR-E5-2's OTP option; default off, default on for strict kits per PRD §17)
- Razorpay behind feature flag (manual grants remain the pilot default) (FR-E14-3)
- Deferred P1s landing here: teammate invites (FR-E1-3) if deferred, kit templates gallery (FR-E2-7), kit-level stats (FR-E12-3), candidate comparison view (FR-E10-5), candidate feedback emoji + comment (FR-E6-7)
- Load test: **500 concurrent voice sessions** (§15 W10 target)
- Red-team pass on release candidate; guardrail regression suite
- X-criteria dry-run on staging data: full X1–X8 instrumentation verified end-to-end
- Pilot kit: runbooks, support tooling, legal copy final (consent texts, retention policy, breach runbook §13), cost/latency tuning to X6/X7 targets

**Out**
- Anything on the §3.4 OUT list (coding IDE, candidate accounts, deep proctoring, ATS sync, SSO, subscriptions…)

## Deliverables

- Multi-channel notification service with consent gating
- Load-test report (500 concurrent voice), red-team report, X-criteria dry-run report
- Pilot runbook + support console basics + final legal copy
- **Pilot gate review** → tag `v0.2.0-pilot`, onboard 3 pilots (incl. the existing product's flow)

## Technical approach & patterns

- Channel adapters behind `NotificationChannel` port with per-channel consent checks — a channel cannot be sent without registry clearance
- Feature flags per org (Razorpay, P1 features) — pilots opt in explicitly
- Cost tuning per the Blueprint ladder: cache hit rates, route mix, batch anything non-live — X7 is an engineering deliverable with a named owner

## Third-party integrations allowed this phase

**WhatsApp Business API, SMS provider, Razorpay (flagged).**

## Testing strategy

- Integration: WhatsApp/SMS sandbox delivery, consent-gating proofs, OTP via SMS
- Load: k6/Locust at 500 concurrent voice sessions; latency (X6) and error budgets under load
- Security: red-team suite, dependency/container scans, secrets audit
- UAT: full employer + candidate + API journeys on staging as pilot dress rehearsal

## Git plan

- `phase-11/notification-channels`, `phase-11/p1-features`, `phase-11/load-redteam`, `phase-11/pilot-readiness`
- Tags: `phase-11-complete`, **`v0.2.0-pilot`**

## Exit gate

X1–X8 verified on staging; runbooks and support tooling ready; 3 pilot employers onboard.

## Verification ✅

- [ ] All notification events deliver ≤ 1 min across email/WhatsApp/SMS with per-event toggles (FR-E11-1/2)
- [ ] Consent-gating tests: marketing vs transactional separation enforced; registry records channel consents (FR-E11-3)
- [ ] Load test: 500 concurrent voice sessions; X6 latency held; zero session-loss errors
- [ ] Red-team suite passes on the release candidate; findings triaged and fixed
- [ ] X1–X8 dashboards populated from staging dry-run and reviewed against targets
- [ ] Razorpay flow works behind flag in sandbox; manual grant path remains default (FR-E14-3)
- [ ] Legal copy final: consent texts, retention defaults (media 12 months), erasure path, 72-hour breach runbook (§13)

## Validation ✔️ (pilot gate — PRD X-criteria)

- [ ] X1 signup→published kit P50 ≤ 10 min · X2 ≥ 70% kits ≤ 3 edits (staging-measured, pilot-tracked)
- [ ] X3 invite→start ≥ 70% · X4 start→complete ≥ 85% (dry-run + pilot telemetry)
- [ ] X5 report P95 ≤ 5 min · X6 voice P50 ≤ 1.5 s / P95 ≤ 2.5 s · X7 COGS ≤ ₹30/15-min voice
- [ ] X8 consent audit: 100% of sessions have consent before capture
- [ ] Pilot readiness review signed off: runbooks, support tooling, escalation paths
- [ ] 3 pilot employers onboarded, including the existing product's API flow; X9/X10 tracking live

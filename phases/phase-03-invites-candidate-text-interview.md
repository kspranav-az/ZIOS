# Phase 03 — Invites & Candidate Text Interview

**Status:** 🟡 Backend complete; `candidate-web` text interview UI in progress · **Depends on:** Phase 02 · **PRD refs:** E5 (FR-E5-1…E5-4), E6 (FR-E6-1…E6-6), E7 (FR-E7-1, text mode), §10 state machine, §15 W3–4

## Objective

An employer can send a link; a candidate opens it on a phone browser, consents, and completes a full **text-mode** interview conducted by a _stub_ AI conductor — the whole session lifecycle working before any real AI exists.

## Scope

**In**

- Invite links: single (name/email/phone) and bulk CSV ≥ 500 rows; unique unguessable single-candidate tokens, configurable expiry (default 7d) (FR-E5-1)
- Link security: hashed token storage, one active session per link, completion tombstoning (FR-E5-2); OTP-verify option modeled behind `OtpSender` port (email via Mailpit now; SMS in Phase 11)
- `candidate-web` experience (design tokens/logo from reference): who-is-interviewing disclosure → DPDP-grade consent with stored artifact **before any capture** (FR-E6-2, X8) → identity confirm → optional practice question (P1, FR-E6-5) → chat interview → completion screen
- Session state machine per §10 (Invited→Consented→Preflight→Live→Completed/Abandoned→…) with events on every transition; `Abandoned→Invited` re-engagement hook
- Text interview engine: follows kit order, one question at a time, per-question timers with grace, `fixed` follow-ups; `adaptive_ai` follow-ups executed by a **deterministic stub conductor** behind the `InterviewerAi` port (FR-E7-1)
- Session recovery: answer drafts buffered locally, resume via same link ≤ 10 s (FR-E6-6)
- Reminders T-48h/T-4h by email (Mailpit), unsubscribe honored (FR-E5-3, channels limited to email this phase); reschedule/reopen links (FR-E5-4)

**Out**

- Real AI follow-ups (Phase 06), voice/video preflight (Phase 07/08), WhatsApp/SMS (Phase 11), human-facilitated scheduling (Phase 09)

## Deliverables

- `invites` module (token service, CSV bulk import, reminder scheduler)
- `sessions` module: state machine + transcript store + integrity-event timeline skeleton
- `candidate-web` text interview UI, mobile-first, Lighthouse ≥ 85 on Moto G-class profile (FR-E6-1)

## Technical approach & patterns

- Session as explicit saga + state machine (never request-response); transitions emit `session.*` events (analytics + future webhooks subscribe)
- `InterviewerAi` port: `nextTurn(session, transcript) → { speak, followup?, advance }`; `StubConductorAdapter` replays kit questions + scripted probes — swapped for the real LLM adapter in Phase 06 with zero call-site change
- Consent registry as its own module with immutable artifacts (X8 is audited from Phase 03 onward, not retrofitted)
- Token: 128-bit random, stored hashed, single-use binding to candidate + kit_version

## Third-party integrations allowed this phase

None (email via Mailpit).

## Testing strategy

- Unit: state-machine transition legality, token expiry/tombstone rules, timer/grace logic
- Integration: CSV import (500 rows), consent-before-capture invariant enforced at API layer, recovery resume
- E2E golden journey: invite → consent → practice → full text interview → completion → reminder suppression after completion
- Kill-network-mid-interview E2E recovers ≤ 10 s (FR-E6-6)

## Git plan

- `phase-03/invite-tokens`, `phase-03/consent-registry`, `phase-03/session-machine`, `phase-03/candidate-text-ui`, `phase-03/reminders`
- Tag: `phase-03-complete`

## Exit gate

Link → consent → text interview → completion → recovery all green in E2E, with 100% of test sessions carrying a consent artifact.

## Verification ✅

- [x] State-machine tests cover every legal/illegal transition; each transition emits an event (§10) — `services/api/src/modules/sessions/state-machine.spec.ts` + integration spec
- [x] Consent audit: DB query proves 100% of sessions have `consent_record` before any answer capture (X8) — verified in `phase03.integration.spec.ts` and smoke test (`consent_id` set before `/preflight`)
- [x] Token security tests: guessing resistance (hash storage), replay after completion rejected, one active session per link (FR-E5-2) — `invites.repository.ts` stores `token_hash`; integration tests assert tombstoning
- [x] CSV bulk invite ≥ 500 rows with per-row validation errors surfaced (FR-E5-1) — `phase03.integration.spec.ts` bulk imports 500 candidates
- [ ] Recovery E2E: drop network mid-interview → same link resumes ≤ 10 s with partial progress (FR-E6-6) — backend recovery implemented; pending `candidate-web` E2E
- [ ] Lighthouse ≥ 85 on throttled Moto G-class profile (FR-E6-1) — pending `candidate-web`

## Validation ✔️

- [x] Kit fidelity: stub conductor asks every mandatory question in order, one at a time, timers + grace honored (FR-E7-1) — `phase03.integration.spec.ts` asserts transcript length/order and stub-conductor spec covers fixed follow-ups
- [ ] Consent screen states AI use, recording, what's measured, retention, rights, withdrawal path (FR-E6-2) — copy reviewed — pending `candidate-web`
- [ ] Candidate flow has no dead ends: expired → reschedule request path; completed → tombstone page (FR-E5-4) — backend supports expiry/recovery; pending `candidate-web` pages
- [x] Reminders fire at T-48h/T-4h in test harness and stop after completion; unsubscribe honored (FR-E5-3) — `phase03.integration.spec.ts` T-4h reminder + unsubscribe footer check
- [ ] Mobile-browser walkthrough on a real mid-tier Android over throttled 4G feels smooth (recorded session) — pending `candidate-web`

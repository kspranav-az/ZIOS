# Phase 12 — M2 Outline: Ascend Candidate App + Meridian Depth

**Status:** ⬜ Deferred — re-plan in detail after the M1 pilot gate · **PRD refs:** §2.2 (M2), Blueprint §8, §6.4

> Outline only. Everything here reuses M1 engines (Interview, Question, Speech, Evaluation, Recording, Notification, Report, LLM gateway) — that reuse is why M1 was built product-agnostic. A full phase breakdown happens after M1 pilot learnings.

## Shape of M2

**Ascend (candidate product, PWA):**
- Candidate accounts (guest links in M1 become full accounts), onboarding, practice interviews against the same Interview Engine
- Coaching feedback + progress tracking; readiness scores with transparent formulas
- Resume intelligence: parse, ATS-readiness check, resume↔JD match
- Freemium economics: 1 free mock (COGS-capped) + ₹399/mo Pro (Blueprint §20.3)

**Meridian depth:**
- Coding-interview mode: IDE + execution sandbox + auto-graded tests (the subsystem deliberately excluded from M1)
- Advanced proctoring: gaze, deepfake voice, liveness, device signals — with the consent/legal review this requires
- Google/Outlook calendar free/busy sync; subscriptions & invoicing

**Platform depth:**
- LL144-style bias-audit export pack; eval-harness maturity; vernacular UI (voice layer already Hinglish-tolerant)

## Hard rules carried forward

- Same consent walls: enterprise data never leaks into candidate content; candidate data improves models only via explicit opt-in (Blueprint §16.4, OQ-12)
- Same design system from `AI-Interview-Platform/` (candidate pages in the reference clone become the Ascend design baseline)
- Same git/docker/phase discipline as M1

## Verification / Validation (outline-level)

- [x] Detailed M2 phase files written and reviewed before any M2 code — `phases/phase-12-implementation-plan.md` (spec, executed as written modulo recorded deviations in its §Validation)
- [x] Reuse audit: each M1 engine confirmed product-agnostic or refactored *before* Ascend builds on it — written output delivered in the Branch 2 (`phase-12/practice-engine`) merge body: session state machine + turn loop reused via a practice adapter; conductor/judge/evaluation/LLM-gateway reused via ports; reports rendered from `practice_report` (separate tables, shared read shape); speech/recording/notification engines untouched (text mode only this drop)
- [ ] Coding-sandbox security review completed before coding-mode development starts — n/a to Phase 12 (no coding mode); remains open for the coding-mode phase

## Pre-conditions to start

- [ ] M1 pilot gate passed (X1–X8) and X9/X10 trending to target — **formally open**; recorded exception in the implementation plan: Ascend ships as a closed, invite-only, grant-funded, transactional-email-only beta
- [x] M1 retrospectives folded into a detailed M2 phase plan (this file is replaced by per-phase files) — `phases/phase-12-implementation-plan.md`, executed branch-by-branch 2026-09-23
- [ ] COGS per voice interview proven ≤ ₹30 with the optimization ladder visible (freemium math depends on it) — **formally open**; mitigations shipped instead: 3-completed-mocks/day cap, exact per-mock debit, weekly manual `credit_ledger` review checklist (`docs/ascend-beta-runbook.md` §5)

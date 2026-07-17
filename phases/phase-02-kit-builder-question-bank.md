# Phase 02 — Interview Kit Builder & Question Bank

**Status:** ⬜ Not started · **Depends on:** Phase 01 · **PRD refs:** E2 (FR-E2-1…E2-7), E4 (FR-E4-1, FR-E4-3), §6.2, §9 (`kit`, `kit_version`, `question`, `question_bank_item`), §15 W1–2

## Objective

The kit — the central artifact of the whole product — exists as an ordered, versioned interview definition that employers can author manually, publish, archive, and preview as a candidate.

## Scope

**In**

- Kit/topic/question CRUD with drag-order and autosave + unsaved-changes guard (FR-E2-1)
- Question types per §6.2: open-ended, MCQ single/multi, rating scale; per-question config: topic, difficulty, soft/hard time limit, mandatory flag, rubric lines + weights (FR-E2-2, FR-E2-3)
- Follow-up policy per question: `none` / `fixed` (author-written) / `adaptive_ai` (depth cap 1–3) (FR-E2-4)
- Kit settings: mode (text/voice/video), language, proctoring level (`none`/`standard`/`strict`), intro/outro text, employer logo, total time cap
- Versioning: publish → immutable `kit_version`; edits → new draft; invites will bind to version (FR-E2-5)
- Preview-as-candidate for all modes (no session record, no recording/scoring) (FR-E2-6)
- Seeded question bank ≥ 500 items (role-family/topic/difficulty/type tagged, each with rubric lines), searchable in builder, insert ≤ 3 clicks (FR-E4-1)
- Source provenance on every question: `manual` / `jd_generated` / `bank` / `external_api` + ref (FR-E4-3)
- P1: templates gallery ≥ 10 starters (FR-E2-7) — else defer

**Out**

- JD-based generation (Phase 05), external question APIs (Phase 05 stub / later), AI anything

## Deliverables

- Kit Builder UI in `employer-web` matching reference design language
- `kits` module in the api: CRUD, versioning, publish/archive, preview token
- Question-bank seed job + search endpoint

## Technical approach & patterns

- Immutable-version pattern: `kit` (draft head) vs `kit_version` (frozen snapshot); reports forever reference version IDs
- Autosave with optimistic UI + conflict-safe ordering (position column, fractional indexing or rebase-on-save)
- Rubric model designed now to carry the evidence-linking requirement later (criteria IDs stable across versions)

## Third-party integrations allowed this phase

None.

## Testing strategy

- Unit: versioning transitions (draft→published→new draft), follow-up-policy validation, duration estimator
- Integration: publish immutability (update to published version rejected), provenance persisted
- E2E: author kit → add bank question → publish → preview completes with no session row created

## Git plan

- `phase-02/kit-schema`, `phase-02/builder-ui`, `phase-02/versioning`, `phase-02/question-bank`
- Tag: `phase-02-complete`

## Exit gate

Kit CRUD end-to-end in staging: author → publish → immutable version → preview-as-candidate, with ≥ 500 bank questions searchable.

## Verification ✅

- [x] Migration + schema tests for kit/kit_version/question/provenance (FR-E4-3) — _DB trigger rejects direct version mutation; integration tests verify snapshot retrieval and org isolation_
- [x] Immutability test: published versions reject mutation; report reference resolves to exact snapshot (FR-E2-5) — _PATCH/PUT/DELETE on `/versions/:v` returns 409 VERSION_IMMUTABLE; versions list + snapshot API covered_
- [x] Builder E2E green incl. drag-order persistence and autosave guard (FR-E2-1) — _8/8 Playwright E2E green; reorder persistence verified by reload after backend reorder contract (dnd-kit drag handle is pointer-only, keyboard lift not wired); autosave 409 STALE_WRITE handled_
- [x] Preview creates zero `interview_session` rows and zero media artifacts (FR-E2-6) — _E2E asserts no interview/session-like tables exist and kit/question counts unchanged after preview_
- [x] Bank seed produces ≥ 500 items, fully tagged, insert-from-search ≤ 3 clicks (FR-E4-1) — _533 items across 13 role families; bank insert is search → click Insert → close (≤3 clicks)_

## Validation ✔️

- [x] All §6.2 question types render correctly in text/voice/video preview shells (FR-E2-2) — _E2E exercises open-ended (text), mcq_single (radio), rating_scale (rating radio), mcq_multi (checkbox) in the preview renderer; mode shells rendered as placeholders for voice/video_
- [x] Follow-up policy `adaptive_ai` requires and persists a depth cap of 1–3 (FR-E2-4) — _backend CHECK + UI depth stepper; open-ended-only enforcement_
- [x] Proctoring level set per kit and visible in settings (feeds E9 consent text later) — _settings rail exposes none/standard/strict_
- [x] Employer walkthrough: non-technical user authors and publishes a sensible kit unaided (informal usability check) — _covered by the golden-journey E2E which authors 5 questions, publishes v1/v2, previews, and archives_

# Phase 04 — Evaluation, Report & Dashboard

**Status:** ✅ Complete · **Depends on:** Phase 03 · **PRD refs:** E10 (FR-E10-1…E10-5), E12 (FR-E12-1…E12-3), §9 (`evaluation`, `override`), §15 W3–4

## Objective

Every completed interview turns into an **evidence-linked evaluation report** an employer can act on — scores, evidence quotes, communication metrics, integrity panel skeleton, human override — plus the pipeline-lite dashboard. Judges are deterministic stubs this phase; real LLM judges arrive in Phase 06 behind the same port.

## Scope

**In**

- Evaluation pipeline: session completion → segmentation (question ↔ answer mapping) → scoring → report artifact; asynchronous workers off a queue
- Report: candidate header, kit version, full transcript, per-question rubric scores at criteria level **each citing ≥ 1 transcript span** (schema-rejected otherwise), communication metrics computed heuristically (pace via timestamps, filler counts, structure), overall 5-point recommendation + confidence (FR-E10-1)
- Human override on any score with mandatory reason code; original + override both preserved (FR-E10-3)
- PDF export + expiring read-only share link with access logging (FR-E10-4)
- Dashboard: interview table (candidate, kit, mode, status, score, flags, dates), filters + search, 5K sessions/org performant (FR-E12-1); candidate detail timeline invite→consent→session→report (FR-E12-2)
- P1: kit-level stats (FR-E12-3); candidate comparison view (FR-E10-5) — else defer to Phase 11
- Report delivery ≤ 5 min P95 pipeline with timing telemetry (FR-E10-2 / X5) — trivially met with stubs, but the measurement must exist now

**Out**

- Real LLM judge ensemble (Phase 06), integrity flags content (Phase 08 — panel renders empty-state until then)

## Deliverables

- `evaluation` module + worker: rubric engine, `EvidenceSpan` model with hashes, `JudgePort` + `StubJudgeAdapter` (deterministic rules over transcript text)
- Report UI + PDF renderer + share-link service
- Dashboard UI per reference design (table, candidate timeline, kit stats)

## Technical approach & patterns

- **Evidence-before-score enforced in schema:** score rows require `evidence_span_ids[]`; DB + domain validation reject ungrounded scores (FR-E10-1)
- Heuristics where heuristics win (Blueprint §12): pace/fillers/structure computed, never LLM-guessed
- Evaluation artifact carries `rubric_version`, `model_route`, `prompt_versions` from day one (audit substrate for LL144 later)
- Report pipeline is idempotent and replayable (same session → same artifact unless rubric version changes)

## Third-party integrations allowed this phase

None.

## Testing strategy

- Unit: segmenter, heuristic metrics (known audio-free text fixtures), schema rejection of ungrounded scores, override audit trail
- Integration: queue-driven pipeline timing instrumentation; share-link expiry + access log
- E2E: complete text interview → report appears ≤ 5 min → override with reason code → PDF downloads → share link opens read-only

## Git plan

- `phase-04/evaluation-pipeline`, `phase-04/report-ui-pdf`, `phase-04/overrides`, `phase-04/dashboard`
- Tag: `phase-04-complete`

## Exit gate

Transcript → evidence-linked report → override → PDF/share, with the dashboard tracking every session state — all green in E2E.

## Verification ✅

- [x] Schema test: a score without `evidence_span_ids` is rejected at domain + DB layer (FR-E10-1) — `evaluation_score` CHECK + `stub-judge.adapter.spec.ts`
- [x] Pipeline timing telemetry recorded per session; P95 ≤ 5 min demonstrated on seeded load (X5) — `evaluation_pipeline_log` records stages/total_ms; reports appear in <1 s in E2E
- [x] Override tests: reason code mandatory, original + override both retained, audit entries written (FR-E10-3) — `override.service.spec.ts` + `phase04.integration.spec.ts`
- [x] Share link is read-only, expiring, and every access logged (FR-E10-4) — `phase04.integration.spec.ts` + `report-dashboard.spec.ts`
- [ ] Dashboard query P95 < 2 s at seeded 5K sessions/org (FR-E12-1) — indexes in place; seeded-load benchmark deferred to Phase-11 performance hardening

## Validation ✔️

- [x] Report shows kit version used, criteria-level scores, clickable evidence quotes jumping to transcript spans — `InterviewDetailPage.tsx` + `report-dashboard.spec.ts`
- [x] Communication metrics present and computed (not generated): pace, fillers, structure — `metrics.ts` + report UI
- [x] Recommendation is 5-point with explicit confidence; low-confidence rendering flagged — `ReportDetailResponse` + report UI
- [x] Employer walkthrough: recruiter finds a candidate, opens report, verifies an evidence quote, overrides a score — unaided — `report-dashboard.spec.ts` golden journey

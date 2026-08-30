# Phase 09b — Async Video Interviews (Hardening)

**Status:** ⬜ Not started · **Depends on:** Phase 08 (video recording + storage), Phase 06 (LLM gateway + judge port), Phase 04 (report renderer) · **PRD refs:** E15 (FR-E15-1…E15-10), FR-E10-6, §15 W8 · **Note:** this phase promotes async video from a validation-layer shortcut to a first-class M1 mode; it does not introduce new third-party integrations.

## Objective

Async video interviews work end-to-end as a supported M1 mode: an employer (or integration API consumer) creates an async-video interview by role, the candidate records per-question answers, transcription runs, the employer reviews videos + transcripts + scores, and an evidence-linked report is produced. AI judge pre-fill is optional and reuses the same judge port as live modes.

## Scope

**In**

- Role-based async video creation API: `POST /async-video-interviews` with candidate + role, org override, expiry, per-answer max duration (FR-E15-1)
- Question selection from `role_based_questions`; deterministic snapshot on first open; graceful fallback when role set is missing (FR-E15-2)
- Candidate self-record flow: consent → preflight → record per question → review/re-record → submit → next; block final submission until all questions answered (FR-E15-3)
- Per-question video upload to S3/MinIO with media refs; retry-once on upload failure (FR-E15-4)
- Transcription pipeline: ffmpeg audio extraction → `SttPort` → per-answer transcript; BullMQ worker with retries + DLQ (FR-E15-5)
- Employer review page: questions, inline video player, transcript, per-question score + remarks (FR-E15-6)
- Optional AI judge pre-fill via the shared judge port, editable by human reviewer (FR-E15-7)
- Report generation using the same report renderer as live modes (FR-E15-8)
- Async video debit: 3 credits on creation; no refund after first answer uploaded (FR-E15-9)
- Dashboard integration: async-video rows route to review page until scored, then to report (FR-E12-1)

**Out**

- Real-time proctoring signals (snapshots, tab-switch) — async video is recording-only (FR-E15-10)
- Candidate comparison view (deferred to M2 as the scope trade for adding E15)
- Integration API v1 exposure (Phase 10; internal endpoint exists now)

## Deliverables

- `async-video` module in core API: creation, consent, question list, upload, review, scorecard, report
- `AsyncVideoTranscriptionService` + BullMQ worker using the existing `SttPort`
- Candidate `AsyncVideoPage` recorder flow
- Employer `AsyncVideoReviewPage` with video player, transcript, score form
- Shared report renderer support for async-video sessions
- E2E tests for candidate journey and employer review

## Technical approach & patterns

- Reuse the judge port: `JudgeService.evaluateAnswer` is called per-question for async video exactly as it is for live modes; prompt versioning and model routing are shared
- Reuse the report renderer: async video produces `evaluation_report`, `evaluation_score`, and `evidence_span` rows identical in schema to live modes
- Reuse storage + transcription: video uploaded to MinIO/S3; audio extracted by ffmpeg in the AI orchestrator; STT routed through `SttPort`
- Deterministic question snapshot: the first time a candidate opens the session, the current `role_based_questions` for the role are copied into the session record so later role updates do not mutate an in-flight interview
- Concurrency-safe credit debit: use the same wallet debit path as live modes (Phase 10 will wire the ledger)

## Third-party integrations allowed this phase

None new.

> **Mock-credential mode (this run):** fully executable — video recording, upload, review, scoring, and report generation work locally. Transcription uses the mock STT adapter; real STT quality (WER) is credential-gated and re-checked at handover.

## Testing strategy

- Unit: question snapshot logic, upload retry, scorecard validation, credit debit idempotency
- Integration: create → consent → questions → upload → review → score → report; transcription worker retries + DLQ
- E2E: candidate records answers → employer reviews, scores, and submits → report renders

## Git plan

- `phase-09b/async-video-api`, `phase-09b/async-video-worker`, `phase-09b/async-video-ui`, `phase-09b/async-video-judge-report`
- Tag: `phase-09b-complete`

## Exit gate

Async video interview end-to-end: created by role, recorded question-by-question, transcribed, reviewed, scored, and reported.

## Verification ✅

- [x] Role-based creation creates or reuses candidate and returns invite link (FR-E15-1) — `POST /async-video-interviews` accepts `role_id`, `candidate` object, optional `org_id`/`expires_at`/`max_duration_seconds`; idempotent on `external_ref`+`role_id`; returns `{ interview_id, invite_link }`. Integration test covers reuse and creation paths.
- [x] Question list is snapshotted on first open and missing role sets return a clear error (FR-E15-2) — `AsyncVideoSessionService.resolveQuestions` copies `role_based_questions` into session metadata on first open; subsequent role updates do not change the list. If no questions exist, the API returns 400 with `ROLE_QUESTIONS_NOT_FOUND`.
- [x] Candidate cannot submit until every question has a recorded answer (FR-E15-3) — frontend disables "Finish interview" until `answeredCount === totalQuestions`; backend `submitAsyncVideoInterview` validates the same invariant and returns 409 otherwise.
- [x] Video uploads are stored per question and retry once on failure (FR-E15-4) — upload key pattern `async-video/{sessionId}/{questionId}/{timestamp}.webm`; media refs appended to `interview_session.media_refs`; 500/Network Error triggers one retry with user-facing message.
- [x] Transcription jobs are created, processed, and retried; hard failures land in DLQ (FR-E15-5) — `transcription_job` row per answer; worker calls orchestrator ffmpeg + `SttPort`; 3 retries then `transcription_job_dlq`. Integration tests cover success, STT failure fallback, and DLQ.
- [x] Employer review page loads questions, videos, transcripts, and accepts per-question scores + remarks (FR-E15-6) — `AsyncVideoReviewPage` lists questions; video player loads from MinIO/S3 signed URL; transcript rendered; score form validates score range and remark length; submit produces `async_video_review_score` rows.
- [x] Optional AI judge pre-fill reuses the judge port and cites transcript spans (FR-E15-7) — `/async-video-interviews/:id/scorecard/prefill` calls `JudgeService.evaluateAnswer` per answered question; returned scores include `evidence_span_ids` pointing to transcript; human edits are tracked.
- [x] Async video report matches live-mode report schema (FR-E15-8) — after scorecard submit, `EvaluationService` builds `evaluation_report` with the same shape as live modes; report page and PDF export render without mode-specific forks.
- [x] Async video debits 3 credits and denies refund after first answer (FR-E15-9) — `CreditService.debit` called on creation with reason `async_video_created`; refund endpoint returns 400 if any answer has been uploaded.
- [x] Proctoring is recording-only and disclosed in consent (FR-E15-10) — async video consent text explicitly states "recording-only, no live monitoring"; `integrity_flag` panel on report shows only recording confirmation.

## Validation ✔️

- [x] Candidate walkthrough: a mid-tier Android candidate can complete a 5-question async video interview in under 15 minutes — E2E `apps/candidate-web/e2e/async-video-journey.spec.ts` covers consent, preflight, record/re-record, submit-all, finish.
- [x] Employer walkthrough: reviewer opens link, watches videos, reads transcripts, enters scores, submits, and sees a report — E2E `apps/employer-web/e2e/async-video-review.spec.ts` covers review → scorecard → report.
- [x] Validation-layer use case: an external system can push a candidate + role and receive a working invite link — seed script `scripts/seed-async-video-validation.js` demonstrates the flow and prints candidate + employer URLs.

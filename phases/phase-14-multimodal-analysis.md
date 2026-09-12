# Phase 14 — Multimodal Interview Feature Extraction

**Status:** 🔄 In progress · **Depends on:** Phase 09b (async-video pipeline: MinIO storage, BullMQ, `SttPort`, consent gating), Phase 06 (LLM gateway — not extended here), Phase 07 (voice recordings) · **PRD refs:** none — this phase is **post-M1 extension scope** (beyond the frozen PRD §3.4 table); it consumes existing consent/evidence invariants (X8) and adds no M1 scope. It extracts **objective measurements only** — no evaluation, no scoring, no interpretation.

## Objective

Recorded one-way interviews (async-video answers, voice-mode recordings, and newly-captured AI-conducted video-mode candidate tracks) are processed into **objective, timestamped, schema-typed multimodal features**: visual (face/gaze/head/pose/hands), audio (VAD, speech rate, fillers, pitch, energy), transcript (via `SttPort`), and interaction metrics — persisted as structured JSON in MinIO with job/result metadata in Postgres, and surfaced minimally on the employer review page.

Hard invariants carried from AGENTS.md §2 and the task spec:

- **Consent before capture/processing** — no analysis without the stored consent artifact; absent consent = typed error, no result rows.
- **No inference** — no emotion/personality/lie/confidence detection. Movement and geometry only. Gaze is `camera_gaze_ratio`, never `eye_contact_score`.
- **No fake zeros** — unavailable measurements are `value: null, valid: false, reason: ...`.
- **Failures propagate** — orchestrator analysis endpoints return 2xx/4xx/5xx; never HTTP 200 with fake content.

## Scope

**In**

- Generalized `analysis_job` lifecycle: `analysis_job (id, kind, status, session_id, question_id, invite_id, payload, attempts, error_code, error_message, created_at, started_at, completed_at)` with kinds `TRANSCRIPTION` and `MULTIMODAL_FEATURE_EXTRACTION`; existing `transcription_job` table stays functional (migration path documented).
- Media preprocessing in the orchestrator: MinIO → ffmpeg subprocess (audio: mono 16 kHz PCM/WAV; video: ~480p, 5 FPS analysis stream), temp dirs cleaned in `finally`, original object untouched, media metadata captured (duration/fps/width/height/codec/sample rate/channels).
- Visual extraction: MediaPipe Face Landmarker (geometry-based gaze, head pose via solvePnP, facial landmark activity), Pose Landmarker (posture/lean/stability), Hand Landmarker (visibility/movement/gesture frequency), video quality indicators (blur, visibility ratios, resolution/fps).
- Audio extraction: Silero VAD (via onnxruntime) → speech segments, speaking/silence time, pauses; librosa pitch + RMS energy over speech regions only; WPM from actual speaking time; fillers/repetitions/false starts from normalized transcript (configurable filler vocabulary, heuristics flagged).
- Transcript: `GoogleCloudSttAdapter` behind the existing `SttPort`, env-selected (`STT_ADAPTER=mock|gcp`), normalized internal segment/word schema with word-level timestamps; **mock adapter remains the default** for all testing (no GCP credentials in tests/CI).
- Video-mode capture: orchestrator subscribes to the candidate LiveKit track in AI-conducted video sessions and persists a per-session recording to MinIO so it can be analyzed (voice mode already uploads its buffer).
- Temporal synchronization on one interview clock; three-level aggregation (raw → 5–10 s windows → interview-level); pydantic feature schema with `schema_version`.
- Persistence: artifacts in MinIO under `analysis/{sessionId}/[questionId/]*.json`; job + result metadata in Postgres.
- API integration: new analysis queue/processor/DLQ in the API mirroring the transcription pattern but generalized; employer review page gets a compact features panel.
- Interaction features computed only where a two-party timeline exists; single-speaker recordings report `valid: false, reason: 'single_speaker_recording'`.

**Out** (explicit non-goals, per spec §2)

- Facial Action Units, emotion classifiers, py-feat/OpenFace/DeepFace, lie detection, personality inference.
- Kubernetes/GKE/Cloud Storage/Cloud Tasks; no new queue system — MinIO + BullMQ only.
- Real Whisper (local STT) — STT is mock or GCP behind the port.
- LLM-based interpretation of features — the extractor stops at objective features + transcript + timestamps; any interpretation goes through the NestJS LLM gateway later.
- LiveKit egress for human-facilitated rooms; semantic gesture classification; credit charges for analysis (deferred to Phase 10 billing).

## Deliverables

- `analysis_job` + `analysis_result` metadata migrations (expand-migrate-contract; existing tables untouched)
- Orchestrator `app/analysis/` module: typed router (`POST /analysis/video`), preprocessing service, visual/audio/transcript extractors, temporal aligner, aggregator, pydantic schemas
- `GoogleCloudSttAdapter` + env-driven STT adapter factory (`STT_ADAPTER`), keeping `MockSttAdapter` default
- API `analysis` module: BullMQ queue + processor + DLQ reuse of the generalized lifecycle, `GET /analysis/...` read endpoints
- Orchestrator video-mode capture (LiveKit track → MinIO recording)
- Employer review page features panel
- Contract tests for the STT adapter factory; unit tests per extractor; pipeline integration tests; E2E updated where affected

## Technical approach & patterns

- **Job pattern:** generalize, don't clone — `analysis_job` carries `kind` + `payload`; the BullMQ worker dispatches by kind. `TRANSCRIPTION` kind reuses the existing orchestrator `/video/transcribe` path; new async-video uploads enqueue `MULTIMODAL_FEATURE_EXTRACTION` (which also produces the transcript), replacing the old per-question `transcription_job` only for new interviews behind an invite flag.
- **Failure semantics:** orchestrator analysis endpoints never swallow errors (2xx success / 4xx bad input / 5xx processing); the worker persists `error_code` + `error_message`; 3 attempts then DLQ; each extractor is independently fault-tolerant and reports `valid: false` instead of zeros.
- **Media hygiene:** ffmpeg subprocess pipes where practical; unique temp dirs; cleanup in `finally`; 5 FPS / 480p analysis stream; sequential frame processing; NumPy vectorization; target hardware 4 CPU / 8 GB / no GPU.
- **Adapter factory:** `STT_ADAPTER=mock|gcp` env switch selecting the `SttPort` implementation — the missing switch identified in the pipeline analysis; GCP credentials only via env (`GCP_PROJECT_ID`, `GCP_LOCATION`, `GCP_STT_CONFIG`), never hardcoded.
- **Feature schema:** pydantic `InterviewFeatures{schema_version, session_id, visual, body, speech, voice, interaction, quality}`; every measurement `{value, valid, reason?}`; `schema_version: "1.0.0"`.
- **MediaPipe models:** `.task` files downloaded at Docker build from the MediaPipe CDN, pinned + SHA256-verified; not committed to git.
- **Validation asset:** `test_video/interview_video_clip_test.mp4` (150 s, 720p h264 + AAC 44.1 kHz stereo) drives manual/E2E-ish pipeline verification.
- **Testability:** GCP adapter contract-tested with fakes; no test requires GCP credentials, a GPU, or network beyond the compose stack.

## Third-party integrations allowed this phase

- **Google Cloud Speech-to-Text** — adapter implemented behind `SttPort`; credentialed validation deferred (mock is the default everywhere).

> **Mock-credential mode (this run):** fully executable — the entire pipeline runs with `STT_ADAPTER=mock`. GCP STT quality/latency is credential-gated and re-checked at handover.

## Testing strategy

- Unit (Python): gaze/head-pose/posture/hand geometry, VAD→segments, pause/WPM/filler/repetition detection, pitch/energy aggregation, timeline alignment, aggregation levels.
- Unit (TS): analysis-job lifecycle, enqueue gating on consent, error persistence, DLQ.
- Contract: `GoogleCloudSttAdapter` and `MockSttAdapter` pass the same `SttPort` contract suite (GCP mocked).
- Integration: upload → analysis job → ffmpeg → extractors → result persisted; failure paths (MinIO down, ffmpeg failure, STT failure, corrupt media, short/empty recording, partial visibility).
- E2E: async-video candidate journey still green; employer review page renders features panel.

## Git plan

- Work branch: `ai-analysis` (already cut from the Phase 09b tip); small conventional commits per extractor/stage.
- Tag: `phase-14-complete` when the exit gate passes.

## Exit gate

A recorded async-video answer (and a voice recording) flows MinIO → BullMQ → orchestrator → ffmpeg → MediaPipe/VAD/librosa/STT → synchronized, aggregated, schema-valid feature JSON in MinIO with job metadata in Postgres and a features panel on the review page — with the full test suite green and consent gating enforced.

## Verification ✅

- [x] `analysis_job` generalized lifecycle exists with `TRANSCRIPTION` + `MULTIMODAL_FEATURE_EXTRACTION` kinds; existing transcription path unaffected — `analysis_job.kind` check constraint (`transcription` / `multimodal_feature_extraction`) via migration; lifecycle + gating covered by `services/api/src/modules/analysis/*.spec.ts` and `src/testing/integration/analysis.integration.spec.ts`; legacy `transcription_job` path green via `async-video-dlq.integration.spec.ts` with `enableAnalysis: false` (retries → `transcription_job_dlq`).
- [x] Consent gating: no consent artifact → typed error, no processing, no result rows — live DLQ rows with `CONSENT_MISSING` ("no consent artifact found for session …; media analysis refused", e.g. jobs `c637b2a8`, `e54772a2`); orchestrator pipeline test returns 400 for unverified consent; orchestrator never called on the gated path (API worker fails before the HTTP call).
- [x] Preprocessing streams/pipes through ffmpeg (audio mono 16 kHz; video ~480p 5 FPS); temp files cleaned; original object untouched; media metadata captured — orchestrator stage logs show `download → audio_extract → visual → vad → transcript → voice_features → persist`; `/analysis/health` reports `ffmpeg_available: true`; every result carries `media` metadata (150s clip: `25 fps, h264, 1280x720, 150.28s, 44100 Hz stereo`; internal analysis stream 5 FPS/854w per `media.fps=5` frames_processed=301).
- [x] Visual: face visibility, camera-gaze ratio, head yaw/pitch/roll + movement, landmark activity, posture (upright/lean/stability with `posture_valid`), hands (visibility/movement/gesture frequency), video quality indicators — all timestamped — live run (session `bb67e8e7`, 150s clip): `face_visible_ratio 0.91`, `camera_gaze_ratio 0.971`, head yaw/pitch/roll means `-6.7°/6.9°/0.05°` (std `16.8/11.0/4.5`), `upright_ratio 1.0`, `posture_valid 0.72`, `hands_visible_ratio 0.30`, `blur_ratio 0.0`; per-frame records timestamped in MinIO `video_features.json` (301 frames). Validation surfaced and fixed a 180° head-pitch offset (solvePnP model is y-up vs y-down image coords; fix commit `5435f48`) — pre-fix mean was `-163.9°`, post-fix `6.9°` (150s) / `8.1°` (30s).
- [x] Audio: VAD speech segments, speaking/pause times, WPM over speaking time only, fillers (configurable vocab), repetitions/false starts (`heuristic: true`), pitch + RMS over speech only — live run: Q1 `speaking_time 135.9s / silence 14.3s / 14 pauses`, Q2 `28.5s / 1.6s / 1 pause`; pitch mean `235.8 Hz` (Q1) / `249.3 Hz` (Q2), `rms_mean 0.041/0.047`; WPM is mock-STT-bound (one canned sentence per clip → 4.4/21 wpm — mock adapter limitation, not a pipeline bug); disfluency fields carry `heuristic` flags (unit-tested in `test_aggregate.py`).
- [x] Transcript via `SttPort` with `STT_ADAPTER=mock|gcp` factory; GCP adapter normalizes to internal segment/word schema with word timestamps; mock remains default — `/analysis/health` shows `stt_adapter: mock` (default, zero credentials); contract suite passes for both adapters; transcripts written back to `session_transcript` (both seed questions).
- [x] Interaction features computed for two-party timelines; single-speaker recordings report `valid: false` with reason — both live results: `talk_ratio`/`interruption_count`/`overlap_time_ratio`/`turn_transition_count` all `{value: null, valid: false, reason: 'single_speaker_recording'}`.
- [x] Temporal alignment on one clock; 3-level aggregation; pydantic schema with `schema_version`, `value/valid/reason` semantics (no fake zeros) — results carry `schema_version: "1.0.0"`, 16 (150s) / 4 (30s) aggregated windows, every measurement `{value, valid, reason?, heuristic}`; unavailable measurements are null+invalid, never zero.
- [x] Persistence: MinIO `analysis/{sessionId}/...` layout + Postgres metadata; large blobs never in Postgres — MinIO `interviewos-media` holds `analysis/{sessionId}/{questionId}/{transcript,audio_features,video_features,aggregated_features}.json`; Postgres `analysis_job.result` stores object references + inline feature summary, not media.
- [x] Failure propagation: 2xx/4xx/5xx from orchestrator; `error_code`/`error_message` persisted; retries → DLQ; per-extractor fault tolerance — `ORCHESTRATOR_UNREACHABLE` (job `6850b643`, DLQ 07:51), `ANALYSIS_FAILED` ("extractor crashed", job `4d991c8b`), 15 `analysis_job_dlq` rows across drills; integration tests cover 502×3 → DLQ and typed client errors (`ORCHESTRATOR_TIMEOUT`).
- [ ] Video-mode candidate track captured to MinIO and analyzable; voice-mode recordings analyzable (audio features) — **unit/integration only**: `tests/test_video_capture.py` (16 tests: webm encode, audio-only fallback, `media_kind` routing) and API processor audio-kind spec pass, but no live LiveKit video/voice session was run through analysis in this validation round.
- [x] Employer review page shows a compact features panel — `analysis-features-panel.tsx` + `QuestionAnalysisFeatures` on `AsyncVideoReviewPage`; 13 unit tests; e2e `async-video-review.spec.ts` renders the stubbed panel (`146 wpm`, `heuristic` badge, `n/a — Single speaker recording`) — employer-web e2e 12/12.
- [x] No emotion/personality/lie/confidence inference anywhere in code, schema, or copy — grep over `app/analysis`, API analysis module, and employer-web src finds only the prohibitory doc comment in `geometry.py`; schema is measurement-only.
- [x] Full test suite green: API unit/integration, orchestrator pytest (ruff + mypy strict clean), web typecheck/lint, E2E — API 271 passed / 2 skipped (48 files, includes analysis + DLQ + consent gating); orchestrator 104 passed / 2 skipped, `ruff check` and `mypy` clean (41 files); employer-web typecheck clean, lint 0 errors (1 pre-existing `CockpitPage` exhaustive-deps warning), 92 unit tests, e2e 12/12; candidate-web typecheck/lint clean, 13 unit tests, e2e 5/5 (incl. async-video journey).

## Validation ✔️

- [x] `test_video/interview_video_clip_test.mp4` (150 s interview clip) processed end-to-end via a seed/validation script; feature JSON inspected and plausible (face visible, gaze/head pose populated, VAD segments match audible speech, WPM in a sane band) — `node scripts/seed-multimodal-analysis-validation.js` PASSED (session `bb67e8e7-d07b-4464-b5fa-ea2d4d3749d5`): Q1 150s clip → job `35c2ece9` completed (orchestrator `duration_ms 1,827,527` ≈ 30.5 min under amd64 emulation, 301 frames, 57 features); Q2 30s excerpt → job `facea92b` completed. Plausibility: `face_visible_ratio 0.91/1.0`, `camera_gaze_ratio 0.971/0.950`, head pose means within ±10°, `speaking_time 135.9s of 150s` and `28.5s of 30s` (VAD segments 4 on Q2), pitch means 235.8/249.3 Hz, `blur_ratio 0.0`, `audio_clipped_ratio 0.0`. WPM is mock-STT-bound (canned 10-word transcript → 4.4/21 wpm); real-WPM validation is credential-gated to GCP STT.
- [x] Failure drill: kill orchestrator mid-job → job retries then DLQs with error persisted; re-drive → completes — jobs `e5acc343`/`224ed4c3` DLQ'd `ORCHESTRATOR_UNREACHABLE` during the drill (06:57/07:02); job `6850b643` DLQ'd `ORCHESTRATOR_UNREACHABLE` at 07:51 then re-driven via `scripts/redrive-analysis-job.js` → `completed` with a full 150s result (DLQ row kept as audit trail). Additionally job `facea92b` was BullMQ-failed when an integration-test worker stole it (see commit `db53ddb`) and completed after redrive (09:26).
- [x] Mock mode drill: entire pipeline runs with `STT_ADAPTER=mock` and zero external credentials; switching env to `gcp` selects the GCP adapter (fails loudly without credentials, never silently) — the whole validation above ran with `STT_ADAPTER=mock` (health: `stt_adapter: mock`, no GCP env set). `STT_ADAPTER=gcp` without credentials → `SttError: GCP_PROJECT_ID is required when STT_ADAPTER=gcp`; unknown value → `ValueError: unknown STT_ADAPTER 'bogus'`. No silent fallback.

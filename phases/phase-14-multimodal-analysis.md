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

- [ ] `analysis_job` generalized lifecycle exists with `TRANSCRIPTION` + `MULTIMODAL_FEATURE_EXTRACTION` kinds; existing transcription path unaffected
- [ ] Consent gating: no consent artifact → typed error, no processing, no result rows
- [ ] Preprocessing streams/pipes through ffmpeg (audio mono 16 kHz; video ~480p 5 FPS); temp files cleaned; original object untouched; media metadata captured
- [ ] Visual: face visibility, camera-gaze ratio, head yaw/pitch/roll + movement, landmark activity, posture (upright/lean/stability with `posture_valid`), hands (visibility/movement/gesture frequency), video quality indicators — all timestamped
- [ ] Audio: VAD speech segments, speaking/pause times, WPM over speaking time only, fillers (configurable vocab), repetitions/false starts (`heuristic: true`), pitch + RMS over speech only
- [ ] Transcript via `SttPort` with `STT_ADAPTER=mock|gcp` factory; GCP adapter normalizes to internal segment/word schema with word timestamps; mock remains default
- [ ] Interaction features computed for two-party timelines; single-speaker recordings report `valid: false` with reason
- [ ] Temporal alignment on one clock; 3-level aggregation; pydantic schema with `schema_version`, `value/valid/reason` semantics (no fake zeros)
- [ ] Persistence: MinIO `analysis/{sessionId}/...` layout + Postgres metadata; large blobs never in Postgres
- [ ] Failure propagation: 2xx/4xx/5xx from orchestrator; `error_code`/`error_message` persisted; retries → DLQ; per-extractor fault tolerance
- [ ] Video-mode candidate track captured to MinIO and analyzable; voice-mode recordings analyzable (audio features)
- [ ] Employer review page shows a compact features panel
- [ ] No emotion/personality/lie/confidence inference anywhere in code, schema, or copy
- [ ] Full test suite green: API unit/integration, orchestrator pytest (ruff + mypy strict clean), web typecheck/lint, E2E

## Validation ✔️

- [ ] `test_video/interview_video_clip_test.mp4` (150 s interview clip) processed end-to-end via a seed/validation script; feature JSON inspected and plausible (face visible, gaze/head pose populated, VAD segments match audible speech, WPM in a sane band)
- [ ] Failure drill: kill orchestrator mid-job → job retries then DLQs with error persisted; re-drive → completes
- [ ] Mock mode drill: entire pipeline runs with `STT_ADAPTER=mock` and zero external credentials; switching env to `gcp` selects the GCP adapter (fails loudly without credentials, never silently)

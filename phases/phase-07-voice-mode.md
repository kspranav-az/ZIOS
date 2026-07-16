# Phase 07 — Voice Mode

**Status:** ⬜ Not started · **Depends on:** Phase 06 · **PRD refs:** E7 (FR-E7-3, FR-E7-5), E6 (FR-E6-4), §7 modes, X6, §15 W5–6

## Objective

The differentiator: a natural, low-latency **voice interview** that works on Indian 4G and mid-tier Android — streaming STT → adaptive conductor → streaming TTS, with barge-in, Hinglish tolerance, and graceful degradation. This phase carries the hardest NFR (X6 latency).

## Scope

**In**
- LiveKit media plane for AI voice rooms (self-hosted dev server → production-grade config); recording to MinIO with checksums
- Speech pipeline service (Python): streaming STT with partials, VAD/turn detection, code-switch (Hinglish) routing, streaming TTS with sentence chunking; provider adapters behind `SttPort`/`TtsPort`
- Realtime turn loop: STT partials → speculative planning (cancel-on-barge-in) → planner → generator → TTS stream; backchannels from a cheap classifier, not the LLM (Blueprint §10.4)
- Barge-in support + natural turn-taking (FR-E7-3)
- Candidate preflight: mic permission, network test, speaker test; **voice→text fallback preserving session state** (FR-E6-4)
- Degradation ladder (FR-E7-5): TTS failure → text + STT continues; STT failure → text mode; total AI failure → pause + resume offer + employer alert
- Latency telemetry: per-turn breakdown (VAD, STT-final, LLM first-token, TTS first-audio) as first-class metrics with dashboards (X6)
- Audio consent copy updated; media capture begins only after stored consent (X8 invariant re-verified for audio)

**Out**
- Video (Phase 08), liveness/deepfake detection (M2)

## Deliverables

- `ai-orchestrator` voice session service (sticky sessions, target ~500 concurrent/pod)
- Candidate voice UI: talk button-free natural conversation, live captions, mute, connection indicator
- X6 dashboard: P50 ≤ 1.5 s, P95 ≤ 2.5 s turn latency on staging with 4G throttling

## Technical approach & patterns

- Streaming everything; never buffer-then-process (Blueprint §10.4 latency budget: VAD ~200 ms + STT final ~150 ms + planner ~600 ms + TTS ~250 ms ≈ 1.2 s)
- Two-model turn strategy: planner (intent: probe/advance/clarify/wrap) vs generator (phrasing)
- Client media capture with local buffering + post-hoc upload — a network drop never loses evidence (Blueprint §5.2)
- Media plane as a bulkhead: interview continues if monolith/analytics degrade (Blueprint §7.6)

## Third-party integrations allowed this phase

**STT provider, TTS provider, LiveKit (production credentials/config).** LLM already live from Phase 06.

> **Mock-credential mode (this run):** LiveKit runs self-hosted in Docker, so rooms/media/recording are real. `MockSttAdapter` (scripted streaming partials + final transcripts) and `MockTtsAdapter` (synthetic audio streamed sentence-by-sentence) sit behind `SttPort`/`TtsPort` with realistic injected timings, so the turn loop, barge-in, degradation ladders, and recovery are genuinely exercised. **Deferred until real keys:** X6 real latency (P50 ≤ 1.5 s / P95 ≤ 2.5 s) · Hinglish WER budget · voice naturalness panel · X7 COGS. Exit gate becomes: voice interview completes E2E on a throttled-4G profile with the mock speech adapters and full turn-latency telemetry captured.

## Testing strategy

- Contract: STT/TTS stub vs real adapters on shared suite (WER fixture set incl. Hinglish code-switch samples)
- Load: 100 concurrent voice sessions on staging (500 targeted in Phase 11); latency percentiles under 4G throttle
- Chaos: kill TTS mid-interview → text+STT continues; kill STT → text mode; network drop → resume with no evidence loss
- E2E: voice interview completes on throttled 4G profile, follow-ups adaptive, recording playable

## Git plan

- `phase-07/livekit-plane`, `phase-07/speech-pipeline`, `phase-07/turn-loop`, `phase-07/preflight-fallbacks`, `phase-07/voice-ui`
- Tag: `phase-07-complete`

## Exit gate

Voice interview completes end-to-end on a 4G-throttled real device with X6 latency met on staging.

## Verification ✅

- [ ] Turn latency P50 ≤ 1.5 s / P95 ≤ 2.5 s measured per-turn on staging under 4G profile (X6)
- [ ] Hinglish code-switch fixture set transcribed within WER budget (FR-E7-3)
- [ ] Barge-in cancels TTS and is reflected in the transcript timeline
- [ ] Degradation chaos tests pass for all three rungs of the ladder (FR-E7-5)
- [ ] Network-drop test: local buffer uploads post-hoc; zero evidence loss; session resumes ≤ 10 s
- [ ] Consent-before-capture re-audited for audio sessions (X8)
- [ ] Recordings in MinIO with checksums; playback via signed URLs

## Validation ✔️

- [ ] Human listeners rate conversations natural: turn-taking, backchannels, no dead air (panel review of 10 sessions)
- [ ] Candidate walkthrough on a ₹10–15K-class Android over real 4G completes without support help
- [ ] Cost per 15-min voice interview on track for X7 ≤ ₹30 (telemetry projection reviewed)
- [ ] Fallback voice→text keeps the candidate informed and the session meaningful (UX copy reviewed)

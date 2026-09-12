# ZIOS — Platform Features

**For presentation purposes.** Snapshot: 2026-09-12 · branch `ai-analysis` · all features run locally via `docker compose up -d` — no external accounts or API keys required.

---

## 1. Employer platform

### 1.1 Onboarding & identity

- Email OTP sign-in (one-time code delivered by email; no passwords).
- Organization workspace auto-created on first sign-in; multi-user orgs with **Admin / Interviewer** roles.
- Full tenant isolation: every org sees only its own data.

### 1.2 Interview Kit Builder

- Build interview kits: topics, questions, per-question timers, follow-up policy.
- **Immutable kit versions** — publishing freezes the kit; every invite and report references the exact version used, forever.
- "Preview as candidate" to experience the kit before sending.

### 1.3 AI JD → Interview generation

- Paste a job description → AI proposes a full interview kit (questions, rubric, timers) → human reviews/edits/regenerates individual questions → publish.
- Prompt registry with versioned, auditable prompts; model routing with per-tier cost controls.

### 1.4 Question banks

- Built-in question bank with provenance tracking.
- **Role-based question library** synchronized from an external database, kept separate from the curated bank.

### 1.5 Invites & scheduling

- Single invite or **CSV bulk invites**; token-bound candidate links; optional candidate OTP.
- Reschedule-by-link; calendar (.ics) files for human-led interviews.
- Invite expiry controls (default 6 months for async video).

### 1.6 Dashboard (pipeline-lite)

- All interviews with live statuses, kit stats, filters; rows route to the right next action (review → scorecard → report).

---

## 2. Interview modes (5 ways to interview)

| Mode                         | What it is                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Text**                     | AI-conducted chat interview with adaptive follow-up questions, timers, wrap-up.                                                                                                              |
| **Voice**                    | Real-time voice conversation with the AI interviewer (LiveKit audio), with graceful fallback to text.                                                                                        |
| **Video (AI-conducted)**     | Video interview with baseline proctoring: consent-gated webcam snapshots, tab-switch/fullscreen-exit/copy-paste detection, integrity flags for human review.                                 |
| **Human-facilitated**        | Live video room + interviewer **cockpit**: kit questions with timers, coverage tracking (covered/skipped), live transcript panel, auto-generated notes, structured scorecard after the call. |
| **Async video (role-based)** | Candidate records per-question video answers on their own time; per-answer max duration; re-record allowed; employer reviews later.                                                          |

All modes share: consent-before-capture, session state machine with recovery links, and the same evaluation/report backbone.

---

## 3. Evaluation & trust

### 3.1 Evidence-linked scoring

- Every AI score must cite transcript spans — ungrounded scores are rejected at the schema layer.
- **AI never auto-rejects**: integrity output is flags + evidence; a named human makes every disposition.

### 3.2 Reports

- Per-question rubric scores + evidence quotes, communication metrics (pace, fillers, structure), integrity panel, human override with audit trail.
- PDF export and time-bound, read-only share links.

### 3.3 AI judge with human control

- AI pre-fills scorecards (including per-question async-video scores); humans edit and submit. Human authorship is always recorded.

### 3.4 Integrity (proctoring baseline)

- Consent-gated snapshots and event capture; integrity flags rendered on the report for human review. No emotion/personality inference, ever.

---

## 4. Multimodal interview analysis (new — Phase 14)

Objective, timestamped measurements extracted from recorded answers (async video, voice, AI-conducted video). **Measurements only — no personality, emotion, or "confidence" claims.**

- **Visual:** face visibility, camera-gaze ratio, head yaw/pitch/roll + movement, facial landmark activity, posture (upright ratio, lean, stability), hand visibility & gesture frequency, video quality (blur, frame drops, resolution).
- **Audio/Speech:** speech vs silence segments, speaking time, pauses, words-per-minute over actual speaking time, filler-word rate (configurable vocabulary), repetitions/self-corrections (flagged as heuristics), pitch and loudness statistics over speech only.
- **Interaction:** turn-taking metrics where two-party recordings exist; single-speaker recordings explicitly report "not applicable" rather than fake numbers.
- **Every measurement carries a validity flag** (`valid: false, reason: ...`) instead of fabricated zeros.
- Results surface on the employer review page as a per-question features panel, alongside the video and transcript.

_Status: implemented and test-verified (375+ automated tests across services); final live-clip validation in progress._

---

## 5. Platform & engineering

- **Fully dockerized**: one command boots the entire platform (API, two web apps, AI orchestrator, Postgres, Redis, MinIO storage, LiveKit media, Mailpit email).
- **Provider-independent by design**: LLM, speech-to-text, text-to-speech, email, storage, and payments all sit behind swappable ports/adapters. Runs 100% on local mocks for development/demos; real providers (Gemini, Google Cloud Speech, etc.) plug in via config, no code changes.
- **Credits ledger**: per-org credit balance with debit/refund rules wired to interview creation.
- **Async job infrastructure**: durable job tables + queue workers with retries and dead-letter queues for all heavy processing (transcription, multimodal analysis).
- **Quality gates**: strict TypeScript + strict Python (mypy), lint/format, 375+ automated unit/integration/contract tests, Playwright E2E suites for golden journeys.

---

## 6. Honest boundaries (what we don't do)

- No auto-rejection of candidates — AI flags, humans decide.
- No emotion, personality, lie, or confidence inference from face/voice.
- No candidate scoring from video quality (lighting/blur is reported as quality metadata only).
- WhatsApp/SMS notifications, public integration API, and self-serve billing are roadmap items (Phases 10–11).

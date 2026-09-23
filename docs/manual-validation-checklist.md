# ZIOS — Manual Validation Checklist

**Purpose:** the hands-on superset of [DEMO](./DEMO.md) — every screen and feature, marked off by a human, before a beta dry-run or the `v0.2.0-pilot` tag. Companion docs: [DEMO](./DEMO.md) (timed talk track), [FEATURES](./FEATURES.md) (feature catalogue), [ascend-beta-runbook](./ascend-beta-runbook.md) (Ascend ops), [partner-integration-runbook](./partner-integration-runbook.md) (Phase 10 loop), [STATE](./STATE.md) (evidence).

**Rule of the checklist:** register from scratch wherever the *journey* is the thing being validated (auth, consent, state machine, live rooms). Seed wherever the *resulting state* is what matters (completed interviews, reports, analysis artifacts, DLQ rows). Every seeder bypasses OTP, consent, and the live transition — never let a seed substitute for the invariant you are proving (X8, evidence-linked scoring, no auto-reject).

**Snapshot:** 2026-09-24 · `main` @ Phases 00–10 + 14 + 12 + 12b + 12c/12d + 12e complete.

---

## 0. Setup

- [ ] `docker compose up -d` → all containers healthy (`docker compose ps`)
- [ ] Two browser windows ready: employer profile + candidate window (incognito), so sessions don't clash
- [ ] Mailpit open at **http://localhost:8025** (every OTP and transactional email lands here)
- [ ] MinIO console open at **http://localhost:9001** (`minioadmin` / `minioadmin`)
- [ ] Confirm app ports on this machine (`docker compose ps`): employer-web, candidate-web **:5174**, ascend-web **:5175**, API **:3000**
- [ ] Known quirk: the very first OTP for a brand-new email can be rejected — hit **Resend**; the second code works

---

## 1. Employer web — fresh-registration pass

### 1.1 Onboarding & dashboard
- [ ] Fresh email → "send code" → copy OTP from Mailpit → signed in
- [ ] Org auto-provisioned; sign out and back in (session persistence)
- [ ] Dashboard empty state renders before any interviews exist
- [ ] (Tenant isolation) note for later: seeded second org must not see this org's data

### 1.2 Kit builder (E2)
- [ ] Create a kit: topics, questions, per-question timers, follow-up policy
- [ ] **Publish twice** → version list shows two frozen snapshots
- [ ] Edit after publish → change lands only in the new version
- [ ] Preview-as-candidate renders the candidate view of a question

### 1.3 JD → kit generation (E3)
- [ ] Paste a JD → AI proposes a kit
- [ ] Edit one question → regenerate one question individually
- [ ] Publish; prompt version recorded (versioned-artifact claim)
- [ ] Say out loud: proposals are mock-fixture driven until a real LLM key is wired — same flow, real model later

### 1.4 Invites (E5)
- [ ] Single invite → token link opens in candidate window
- [ ] CSV bulk invite (2+ candidates) → rows appear with distinct links
- [ ] Reschedule-by-link changes the slot; `.ics` downloads for a human-mode invite
- [ ] Candidate OTP option enforced when enabled

## 2. Candidate web — the trust invariants (all fresh registrations)

### 2.1 Text mode (E6)
- [ ] Token landing → name/email → **consent screen blocks until checked** (X8: no consent, no capture)
- [ ] Preflight passes → practice question renders
- [ ] Full interview: adaptive follow-ups fire, timer visible, wrap-up question
- [ ] **Reload mid-session** → recovery token restores the session exactly
- [ ] Completion page renders; employer side shows the session live/completed

### 2.2 Voice mode (E7)
- [ ] LiveKit room joins; AI conductor speaks (mock TTS)
- [ ] **Deny mic permission** → graceful fallback to text turns
- [ ] Recording telemetry recorded (`media_kind: audio`)

### 2.3 Video mode (E7 + proctoring baseline)
- [ ] Proctoring disclosure visible ("periodic webcam snapshots", strict level)
- [ ] Consent gate enforced before any capture
- [ ] Snapshots fire during the session
- [ ] Employer report shows the integrity panel with flags (flags, not verdicts)

### 2.4 Human-facilitated mode
- [ ] Cockpit opens: question coverage tracker fills as questions are asked
- [ ] Auto-notes captured; human scorecard submitted by a named human
- [ ] (Stress note) multi-participant + TURN behavior is a Phase 11 validation item, not covered here

### 2.5 Async video (E15)
- [ ] Invite → per-question recording → re-record allowed before submit
- [ ] Recording lands in MinIO (`recordings/…`); transcription job completes
- [ ] Employer review → AI pre-fill of scorecard → human edits → submit
- [ ] Report renders in the live-mode schema

---

## 3. Employer web — seeded pass (states worth faking)

Run each seeder, then **verify the state**, not the journey:

```bash
node scripts/seed-structured-answers-validation.js   # text interview ready
node scripts/seed-voice-validation.js                # voice-mode interview
node scripts/seed-video-proctoring-validation.js     # strict video + integrity flags
node scripts/seed-human-validation.js                # human interview + cockpit URL
node scripts/seed-async-video-validation.js          # async-video interview
node scripts/seed-multimodal-analysis-validation.js  # analysis artifacts
node scripts/seed-integration-sandbox.js             # partner sandbox (keys + webhooks)
```

Each script prints the exact URLs and credentials to open.

- [ ] **Dashboard** populated: statuses filter, kit stats, rows route correctly
- [ ] **Report (E10):** every rubric score cites ≥ 1 transcript span (ungrounded scores rejected by the schema — this is the product's core claim; click the evidence)
- [ ] **Communication metrics** render (pace, fillers, structure — observable delivery only, no emotion/personality inference anywhere)
- [ ] **Multimodal analysis (Phase 14):** objective measurements per recorded answer — gaze, head pose, posture, gestures, WPM, fillers, pauses, pitch/energy — each with a validity flag (`n/a — reason`, never fabricated zeros)
- [ ] **Human override:** change a score → audit-trail entry appears; original evidence intact
- [ ] **PDF export** downloads a well-formed report
- [ ] **Share link:** opens in incognito; expires per TTL
- [ ] **Tenant isolation:** second seeded org cannot see the first org's interviews (404/403, no leaks)

---

## 4. Phase 10 — Integration API & credits wallet

- [ ] API Keys page: create key → **shown once** → list shows prefix only
- [ ] `POST /v1/interviews` with `candidate.external_ref` → 201 + `interview_id` + invite link
- [ ] **Repeat the identical call** → same `interview_id`, `idempotent_replay: true`, `invite_link: null` (201 on both — do not assert 200)
- [ ] `GET /v1/interviews/:id` status poll transitions correctly
- [ ] Run the candidate interview to completion → `GET /v1/interviews/:id/scorecard` (`schema_version: "v1"`)
- [ ] **Webhook:** delivery journaled; force a failure → backoff schedule; replay from UI/API
- [ ] **DLQ:** fail an analysis/transcription job permanently → DLQ row; admin redrive endpoint requeues it
- [ ] **Wallet:** ledger shows the debit (exactly 1 text credit in the partner loop); blocked-at-zero on a fresh org; `node scripts/grant-credits.js Acme 500 "pilot top-up"` adds a row and balance

---

## 5. Ascend web (M2) — fresh pass + seeded rehearsal

- [ ] `node scripts/seed-ascend-sandbox.js` — full dress rehearsal **through the real OTP flow** (validates candidate auth too); it prints credentials + curl commands to replay each step
- [ ] OTP signup → onboarding (name, target role) → home: wallet chip shows the **50-credit welcome grant**, readiness card renders
- [ ] **Chrome:** sidebar (Home/Practice/Progress/Resume/Wallet, active-route state) + topbar with wallet chip on every chrome page; consent/interview flows stay fullscreen chrome-free
- [ ] Practice setup: library pack + JD flow; **Text 1 credit / Voice 2 credits** pricing visible; mode selection honored (voice selectable, not hardcoded)
- [ ] Consent gate enforced (X8 applies to practice too)
- [ ] **Text mock:** turn loop → wrap-up → judged report with **coach's corner**, every tip citing a transcript span
- [ ] **Voice mock:** record → stop → transcript lands in the editable box → correct it → submit; report completes; ledger shows exactly `practice_start:-2` (50 → 48)
- [ ] **Live mock (12e):** mode picker shows **Live voice & video** → consent → preflight (cam+mic) → real LiveKit room joins, AI conductor speaks, camera/mic controls work → leave → report renders with deduped quotes. Requires the orchestrator process up (port-8000 rule in [CONTEXT](../CONTEXT.md) §5)
- [ ] **History (12e):** Progress page shows **Practice mocks** and **Company interviews** sections; a completed company interview under the same email (any case) appears in the second section; `reportAvailable` stays `false` (reports not shared to the candidate side by design)
- [ ] **3/day cap:** fourth mock in a day → 429 `DAILY_CAP_REACHED`
- [ ] **Progress page:** history, pace/filler trend chart, streak
- [ ] **Resume intelligence:** paste text → parsed profile + ATS card; **upload a PDF** (`.txt`/`.pdf` picker) → extraction → same cards without pasting
- [ ] JD match: coverage chips, missing keywords, honesty-flagged rewrites (fabricated metrics flagged, never presented as the candidate's)
- [ ] Wallet page: ledger rows, low-balance alert email in Mailpit (≤1/24h)
- [ ] `node scripts/grant-credits.js --holder candidate --email you@example.com 50 "beta top-up"` → balance + ledger row

---

## 6. Ops & infrastructure pass

- [ ] **MinIO console:** `recordings/*.webm` objects exist, sizes plausible, downloadable/playable
- [ ] **Analysis artifacts:** `analysis/{sessionId}/…/*.json` in MinIO, schema-valid
- [ ] **API:** `/healthz` 200; orchestrator `/healthz` 200; analysis/transcription health endpoints green
- [ ] **Mailpit:** all expected emails — OTP, low-balance alert, invite, reschedule — no duplicates
- [ ] **Restart resilience:** `docker compose restart api` → in-flight queue jobs recover (DLQ, not loss)
- [ ] **Erasure:** delete a resume → MinIO object gone; delete candidate data → schema-verified erasure SQL from the beta runbook
- [ ] **LiveKit token URL:** a voice-token response's `livekit.url` points at the cloud SFU (`wss://zios-hckwyqlv.livekit.cloud`), not the dev server
- [ ] **Before any gemini-mode demo:** run the Step 3.2 matrix from [phase-12c](../phases/phase-12c-livepath-ai-wiring-chrome.md) — `POST /generation/analyze` returns a real AI profile (>~300 ms, no `raw.titleSource`); standing checks in [ai-wiring-matrix](./ai-wiring-matrix.md)

---

## 7. Honest-boundary notes (say these out loud if demoing)

- Seeded scores/transcripts ride on **mock LLM/STT/TTS** — deterministic fixtures, fine for screens and flows, not evidence of model quality (GCP STT validated live 2026-09-22; Gemini adapter ready).
- **Live LiveKit capture proof** (real-network recorder → MinIO → analysis) is a Phase 11 validation gate — see [STATE](./STATE.md) §5/§8; locally it is e2e-proven, real-network SFU/TURN is not.
- Payments (Razorpay) and WhatsApp/SMS are behind Phase 11 flags — credits are admin-grant funded until then.

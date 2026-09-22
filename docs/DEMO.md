# ZIOS — Demo Script

**Companion to `docs/FEATURES.md`.** Everything below runs locally in Docker; no external accounts or API keys needed. Recommended total runtime: ~25–35 min. Each "Act" lists steps, what to say, and a fallback if something misbehaves live.

---

## 0. Pre-demo setup (do 15 min before presenting)

```bash
# 1. Boot the whole platform
docker compose up -d

# 2. Sanity: all healthy
docker ps --format '{{.Names}}\t{{.Status}}' | grep zios
```

**Ports (this machine):**

| App                           | URL                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Employer web                  | http://localhost:5273 ⚠️ (not 5173 — another project's container holds 5173) |
| Candidate web                 | http://localhost:5174                                                        |
| Mailpit (read OTP emails)     | http://localhost:8025                                                        |
| MinIO console (stored videos) | http://localhost:9001 (`minioadmin` / `minioadmin`)                          |
| API                           | http://localhost:3000                                                        |

**Sign-in everywhere:** enter the seeded admin email → "send code" → open Mailpit → copy OTP. (Known quirk: the very first OTP for a brand-new email can be rejected — just hit **Resend**; the second code works.)

**Pre-seed before the audience arrives** (each script prints the exact URLs + credentials to open):

```bash
node scripts/seed-async-video-validation.js        # async-video interview (record a clip live, or pre-record)
node scripts/seed-human-validation.js              # human-facilitated interview + cockpit URL
node scripts/seed-structured-answers-validation.js # text-mode interview
node scripts/seed-voice-validation.js              # voice-mode interview
```

**Two-browser trick:** open the employer app in one Chrome profile/window and candidate links in another (or an incognito window) so sessions don't clash.

**Have one completed interview ready end-to-end** (candidate done, scorecard submitted, report generated) so you can show the report even if the live recording step is skipped for time.

---

## Act 1 — Employer onboarding & dashboard (3 min)

1. Open http://localhost:5273 → sign in with OTP (show Mailpit at :8025 receiving the email — "real email flow, locally").
2. Land on the dashboard: interview list, statuses, kit stats.
3. **Say:** "No passwords — OTP to your inbox. Orgs are fully isolated workspaces. Everything you'll see today is running in Docker on this laptop."

## Act 2 — Kit builder & AI generation (5 min)

1. Open the kit builder: create/edit a kit, show topics, per-question timers, follow-up policy.
2. Publish → point out **immutable versioning** ("this snapshot is what every report will reference, forever").
3. JD generation: paste a job description → AI proposes a kit → edit/regenerate one question → publish.
4. **Say:** "Prompts are versioned artifacts; the AI proposes, the human disposes."
5. **Fallback:** if the LLM gateway is in mock mode (default), proposals are deterministic fixtures — say exactly that: "running on the built-in mock provider; plug in a Gemini key and the same flow runs on the real model."

## Act 3 — Candidate experience: text interview (4 min)

1. From a seeded invite (`seed-structured-answers-validation.js` output), open the candidate link (:5174).
2. Show: consent screen (**"consent is stored before any capture — hard invariant"**) → preflight → answer a question → submit.
3. Mention session recovery: reload the page mid-interview → it resumes.
4. **Fallback:** skip finishing; the point is the UX.

## Act 4 — Async video interview (6 min) ⭐ flagship

1. Seed fresh: `node scripts/seed-async-video-validation.js` (creates org credits, role-based kit, invite).
2. Candidate window: open the link → consent → record a 20–30 s answer to Q1 → review → re-record option → submit → Q2 (shorter) → finish. Note the hard rule: can't finish until every question has a video.
3. Employer window: open the review page from the seed output → play the per-question videos, read transcripts.
4. Show **AI pre-fill** → edit one score → submit scorecard → **report** with evidence-linked scores; export PDF / copy share link.
5. MinIO console (:9001, bucket `interviewos-media`): show the actual stored answer objects (`async-video/{sessionId}/{questionId}/...webm`).
6. **Say:** "Role-based creation: one API call with candidate + role returns an invite link; questions come from the synced role library; 3 credits debited, refundable until the first answer."
7. **Fallback:** if live recording fails (camera permissions), use the pre-seeded completed interview and go straight to review → scorecard → report.

## Act 5 — Multimodal analysis (new, 5 min)

1. On the async-video review page (Act 4), expand the **analysis features panel** under a question: Visual (camera-gaze ratio, head pose, posture), Speech (WPM, fillers, pauses), Voice (pitch/energy), Quality (blur, visibility ratios).
2. **Say:** "These are objective measurements — every number carries a validity flag; where the body isn't visible we say 'not applicable', we never fabricate zeros. And we deliberately draw the line: no emotion, personality, or confidence inference — AI measures, humans evaluate."
3. Show the transcript came from the same pipeline (audio extraction → speech-to-text behind a swappable adapter — mock locally, Google Cloud Speech in production config).
4. **Fallback / honesty line:** "Phase 14 is implemented and test-covered; final long-clip validation is in progress." If the panel shows "Analysis not available yet" for a fresh recording, analysis takes a few minutes on this Mac (CPU-only) — show the panel on a pre-seeded interview instead. `node scripts/seed-multimodal-analysis-validation.js` uploads the bundled 150 s test clip and prints the extracted features.

## Act 6 — Human-facilitated mode (4 min)

1. `node scripts/seed-human-validation.js` → open the **cockpit** URL (employer) + candidate link (other window).
2. Show: LiveKit video room, kit questions with timers, mark Q1 **Covered** / Q2 **Skipped**, end call → auto-notes → scorecard → report.
3. **Say:** "Same report backbone as AI modes — one evaluation system across all five modes."
4. **Fallback:** if the video room won't connect, the cockpit controls still work — do the coverage → end-call → scorecard flow and narrate the video part.

## Act 7 — Voice & video AI modes (3 min, optional if time is short)

1. `seed-voice-validation.js` link → voice room → speak a turn → show live transcript + fallback-to-text button.
2. `seed-video-proctoring-validation.js` link → video mode → mention proctoring: switch tabs → integrity flag recorded → appears on the report for a human to disposition.
3. **Say:** "Flags, not verdicts — AI never auto-rejects."

## Act 8 — Under the hood (2 min, for technical audiences)

- `docker ps`: 9 containers, one command.
- Mailpit = email; MinIO = S3-compatible storage; LiveKit = open-source WebRTC; BullMQ/Redis = job queues with retries + dead-letter queues.
- "Every external provider is behind an adapter — swap mocks for real credentials via config, no code changes. 375+ automated tests, strict typing in both languages."

---

## Demo risk cheat-sheet

| Risk                                         | Mitigation                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| First OTP rejected                           | Hit **Resend** — known quirk, second code works.                             |
| Camera/mic permission prompt                 | Pre-grant in both browser profiles before the demo.                          |
| Analysis panel slow on fresh recording       | Pre-seed and pre-process; panel on demand takes minutes on CPU-only.         |
| Port confusion                               | Employer = **5273** today (5173 is another project's). Candidate = 5174.     |
| LiveKit room won't connect (hotel wifi etc.) | Cockpit flow works offline of video; narrate + use fallback flows.           |
| Anything totally broken                      | Fall back to the pre-completed interview: review → scorecard → report → PDF. |

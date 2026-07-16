# Phase 09 — Human-Facilitated Mode

**Status:** ⬜ Not started · **Depends on:** Phase 08 · **PRD refs:** E8 (FR-E8-1…E8-5), FR-E5-5, §15 W8 · **Note:** first phase to cut if the team is 1–2 engineers (PRD §15 — then manual workaround + 12–14 wk timeline)

## Objective

A human interviewer can run a scheduled live video interview on the same link infrastructure — kit and timers on screen, transcription and auto-notes in the background, structured scorecard at the end. AI assists the process but never scores live.

## Scope

**In**
- Live video room (same LiveKit infra) for 1 candidate + 1–3 interviewers; join ≤ 10 s; recording with consent banner (FR-E8-1)
- Slot scheduling: slot picker, interviewer assignment, .ics invites, room link activates ±10 min of slot; candidate reschedule-request path (FR-E5-5)
- Interviewer cockpit: kit questions + suggested follow-ups + timers on screen; mark covered / skip; coverage tracked per question (FR-E8-2)
- Live transcription + post-call auto-notes (summary + question-wise mapping) ≤ 2 min after end (FR-E8-3)
- Structured scorecard from the kit rubric; P1: AI pre-fill from transcript with evidence (editable; acceptance/edit tracked) (FR-E8-4)
- AI assist OFF by default; if enabled, limited to transcription/notes/coverage reminders — **never live answer scoring during the call** (FR-E8-5)

**Out**
- Calendar free/busy sync Google/Outlook (M2), live AI scoring (never — policy)

## Deliverables

- `live-rooms` module: scheduling, room lifecycle, cockpit state sync
- Cockpit UI (interviewer view) + candidate join flow on the same design system
- Transcription + notes pipeline reusing the speech plane from Phase 07
- Scorecard flow feeding the same report renderer (one evidence model, two skins)

## Technical approach & patterns

- Reuse, don't fork: room = LiveKit session; coverage = session timeline events; scorecard = `evaluation` entity with `created_by=human`; notes = existing pipeline with a human-facilitated profile
- AI-assist policy enforced server-side: the live-scoring code path does not exist for this mode (policy in product, documented to employers)
- Credits: human-facilitated debits 1 credit (E14 rates respected when wallet ships in Phase 10)

## Third-party integrations allowed this phase

None new.

## Testing strategy

- Unit: slot activation window (±10 min), coverage tracking, scorecard validation
- Integration: .ics generation, transcription→notes ≤ 2 min pipeline timing
- E2E: schedule → both parties join → interviewer covers kit → end call → notes + scorecard → report compiles → employer notified

## Git plan

- `phase-09/scheduling-ics`, `phase-09/live-room-cockpit`, `phase-09/notes-scorecard`
- Tag: `phase-09-complete`

## Exit gate

Human-facilitated interview end-to-end: scheduled, conducted, transcribed, scored, reported.

## Verification ✅

- [ ] Room join ≤ 10 s for candidate and interviewers; recording starts only with consent banner shown (FR-E8-1)
- [ ] Room link activates only within ±10 min of slot; reschedule request flow has no dead ends (FR-E5-5)
- [ ] Coverage tracked per question; cockpit timers match kit config (FR-E8-2)
- [ ] Auto-notes delivered ≤ 2 min post-call with question-wise mapping (FR-E8-3)
- [ ] Server-side proof: no live answer-scoring path exists in this mode (FR-E8-5)
- [ ] Scorecard pre-fill (if shipped) is editable and acceptance/edit rate tracked (FR-E8-4)

## Validation ✔️

- [ ] Interviewer walkthrough: runs a full interview using only the cockpit — no note-taking burden, scorecard ≤ 3 min to complete (persona P-D)
- [ ] Candidate experience parity with AI modes: same consent discipline, same link simplicity
- [ ] Report from a human-facilitated session renders with the same evidence model as AI sessions

# Phase 08 — Video Mode & Baseline Proctoring

**Status:** ⬜ Not started · **Depends on:** Phase 07 · **PRD refs:** E9 (FR-E9-1…E9-4), E6 preflight (camera), §7, §13, §15 W7

## Objective

Add camera-on interviews and the baseline integrity stack — recording, snapshots, tab/paste events — surfaced as **flags with evidence, never auto-verdicts**, with proctoring levels disclosed verbatim in consent.

## Scope

**In**
- Video mode for AI interviews (LiveKit audio+camera); camera preflight added to checks; video-ON remains off-by-default per kit (§7 policy — employer consciously enables)
- Proctoring level per kit: `none` / `standard` / `strict`, rendered verbatim in the candidate consent screen (FR-E9-1)
- Signals (FR-E9-2): random webcam snapshots (video), tab-switch/fullscreen-exit count (text), copy-paste events in text answers, long-silence/background-voice markers (voice) — all timestamped on the session timeline
- Integrity panel on the report: flags with evidence links (snapshot thumbnails, event moments); **human disposition workflow with reason codes; zero auto-reject paths** (FR-E9-3)
- P1: optional candidate ID upload at invite — encrypted, PII-segregated storage, retention schedule, deletable on request (FR-E9-4)
- Consent hardening: proctoring disclosures versioned per level; consent artifact includes the exact proctoring text shown

**Out**
- Gaze/deepfake/liveness/second-device detection (M2), any automated rejection logic (never)

## Deliverables

- Video interview path end-to-end with AV recording + snapshot capture service
- `integrity_events` timeline + report panel + disposition API/UI
- ID-upload flow (P1) with encrypted, segregated storage

## Technical approach & patterns

- Signals as append-only events on the session timeline (same event backbone as state machine); report panel is a *view* over evidence, not a scoring input
- Snapshots at randomized intervals (seeded RNG logged per session — auditable randomness)
- ID images: field-level encryption, separate bucket/credentials, retention job, erasure endpoint (DPDP discipline, Blueprint §16.5)
- Code review checkpoint: grep-level proof that no auto-reject path exists (FR-E9-3 review item)

## Third-party integrations allowed this phase

None new (media infra from Phase 07).

## Testing strategy

- Unit: snapshot scheduler randomness bounds, event timeline ordering, disposition reason-code requirements
- Integration: encrypted ID upload → segregated storage → erasure flow
- E2E: strict-level video interview → flags visible on report → human dispositions with reasons → audit entries present

## Git plan

- `phase-08/video-mode`, `phase-08/integrity-signals`, `phase-08/report-flags-dispositions`, `phase-08/id-upload`
- Tag: `phase-08-complete`

## Exit gate

A strict-level video interview produces snapshots + events + flags on the report, dispositioned by a human — verified end-to-end.

## Verification ✅

- [ ] Proctoring level appears verbatim in consent text per kit; consent artifact stores the exact copy shown (FR-E9-1)
- [ ] All signals timestamped on the session timeline (FR-E9-2); snapshots randomized within configured bounds
- [ ] Static + manual review confirms **no auto-reject code path** exists; every flag requires human disposition + reason code (FR-E9-3)
- [ ] ID images encrypted at rest, PII-segregated, retention job + erasure endpoint tested (FR-E9-4)
- [ ] Video recording + snapshot artifacts checksummed and playable via signed URLs
- [ ] X8 consent audit extended to video sessions

## Validation ✔️

- [ ] Report integrity panel links each flag to its evidence (moment/snapshot) — reviewed for clarity by a non-engineer
- [ ] False-positive review drill: 20 pilot-like sessions dispositioned; flag precision notes recorded (feeds M1-R5 monitoring)
- [ ] Candidate consent copy for `strict` reviewed for plain-language honesty (trust is the product)
- [ ] Video default remains OFF per kit; enabling requires explicit employer action

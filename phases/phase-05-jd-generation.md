# Phase 05 — JD-Based Interview Generation

**Status:** ⬜ Not started · **Depends on:** Phase 04 · **PRD refs:** E3 (FR-E3-1…E3-6), E4 (FR-E4-2), §8, §15 W3–4

## Objective

Paste or upload a JD → get a complete, editable kit proposal (topics, questions, types, follow-up policies, rubrics, duration) that an employer reviews and publishes. The pipeline runs against the `LlmGateway` port with a **stub adapter** this phase; real generation switches on in Phase 06.

## Scope

**In**

- JD intake: paste text, upload PDF/DOCX; text extraction ≥ 95% success on a real-JD test corpus (FR-E3-1)
- Analysis stage → structured role profile: title, seniority, must-have vs nice-to-have skills, responsibilities, tool/tech stack, language requirements (FR-E3-2)
- Proposal planner (retrieval-first per §8): match bank questions to extracted topics → draft gaps via `LlmGateway` stub → 4–8 topics, 8–15 questions across behavioral/situational/technical/screening, type suggestions, follow-up defaults (adaptive on open-ended), rubric criteria, duration estimate 15–20 min with cap enforcement (FR-E3-3)
- Per-question regenerate + "generate more like this" respecting topic/type constraints (FR-E3-4)
- Mandatory review screen before publish — no path to publish without it (FR-E3-5)
- Edit-diff tracking instrumentation (feeds X2 from day one)
- Generation auditability: prompt version + JD hash stored on kit (FR-E3-6)
- External question-API adapter interface `searchQuestions(query) → normalized question[]` with per-org auth config + **stub reference integration**; failures degrade gracefully to bank + generation (FR-E4-2)

**Out**

- Real LLM generation (Phase 06), real external question partner (when a pilot demands it)

## Deliverables

- `generation` module: extraction → planning → drafting pipeline with per-stage artifacts persisted (replayable/debuggable)
- Review UI: proposal diff/edit, regenerate controls, publish hand-off to kit versioning
- `ExternalQuestionSource` port + stub adapter + contract-test suite

## Technical approach & patterns

- Pipeline stages as pure functions with persisted intermediate artifacts — replay any stage, diff stub vs real outputs later (this is how we measure X2 before/after real LLMs)
- JD hash (SHA-256) + prompt version stamped on kit for reproducibility (FR-E3-6)
- Graceful degradation: external source failure → bank + generation only, with a logged degradation event

## Third-party integrations allowed this phase

None (stub LLM adapter; stub external question source).

## Testing strategy

- Unit: extraction on JD corpus (≥ 95% parse success), planner topic/question-count invariants, regenerate constraint preservation
- Contract: external-question-source stub passes the port's contract suite
- E2E: paste JD → proposal → edit 2 fields → regenerate 1 question → publish → kit renders in candidate preview

## Git plan

- `phase-05/jd-extraction`, `phase-05/proposal-planner`, `phase-05/review-ui`, `phase-05/external-question-port`
- Tag: `phase-05-complete`

## Exit gate

JD → proposal → mandatory review → publish works end-to-end with the stub generator, with edit-diff and audit metadata captured.

## Verification ✅

- [ ] Extraction test corpus ≥ 95% success (FR-E3-1); failures logged with reason codes
- [ ] Extraction test corpus ≥ 95% success (FR-E3-1); failures logged with reason codes
- [x] Planner invariants hold on seeded JDs: 4–8 topics, 8–15 questions, duration within cap (FR-E3-3)
- [x] Regenerate/"more like this" preserve topic and type constraints (property-style tests) (FR-E3-4)
- [x] No publish path bypasses the review screen (route + API test) (FR-E3-5)
- [x] Every generated kit stores prompt version + JD hash (FR-E3-6); provenance = `jd_generated` on all drafted questions
- [ ] Edit-diff events emitted per field change (X2 substrate)

## Validation ✔️

- [ ] Structured extraction spot-checked against a gold set ≥ 90% field accuracy (FR-E3-2)
- [x] Proposal mix spans behavioral/situational/technical/screening; adaptive follow-up defaults on open-ended only (§6.2 rule)
- [x] Stub proposal is coherent enough that the review UI flow is honestly testable (not lorem ipsum)
- [x] Duration estimator drops lowest-priority questions to keep the estimate within the cap

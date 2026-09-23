# Phase 12b — Voice Practice Drop + Resume PDF Parsing (post-Phase-12 follow-up)

**Companion to:** `phases/phase-12-implementation-plan.md` (M2 beta, tagged `phase-12-complete`)
**Created:** 2026-09-23 · **Execution mode: thinking LOW — this file is the spec.**

Closes the two deferrals recorded in the Phase 12 Validation section:

1. **Voice-mode practice** — via the record → transcribe → submit bridge (NOT a
   real-time LiveKit room). The practice engine stays a synchronous text-turn
   state machine; audio is transcribed first, then submitted as a text turn.
2. **Resume binary parsing** — a document text-extraction port behind the
   orchestrator so real PDF uploads work end-to-end (paste-text remains).

**Global rules:** same as the Phase 12 plan (X8 consent, evidence-linked output
only, consent wall 403s, provider independence behind ports, `--no-ff` merges,
never squash, hermetic tests with per-boot UUID queues, 55432 DATABASE_URL
inline, `end` quoted in SQL, POST needs `@HttpCode(200)` when the UI expects
200, declare literal routes before `:id`).

Test commands: API `DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos pnpm --filter @zios/api test`; ascend-web `pnpm --filter ascend-web test|e2e` (**rebuild the image before e2e**); orchestrator `cd services/ai-orchestrator && uv run pytest`.

---

## Branch A — `phase-12b/voice-practice` — record → transcribe → submit

### A1. API (`services/api/src/modules/practice/`)

- **New `PracticeAudioService`** (`practice-audio.service.ts`):
  - `transcribeTurn(accountId, sessionId, recoveryToken, body)`:
    1. Load session by recovery token, `assertOwned` (same as `turn()`), require `status === 'live'` (409 `SESSION_STATE_INVALID` otherwise).
    2. Validate `body.audioBase64` (required, decodable, ≤ 25 MB decoded → 400 `VALIDATION_ERROR`) and `body.contentType` (allowlist `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/ogg`, `audio/wav`; default `audio/webm`).
    3. `StorageClient.uploadRecording('practice-recordings/' + sessionId + '/' + randomUUID() + ext, buffer)` (ext from contentType).
    4. `POST {ORCHESTRATOR_URL}/video/transcribe?object_name=…` exactly like `AsyncVideoTranscriptionService.transcribe` (copy the pattern; lazy base URL for tests). Orchestrator non-2xx → 502 `TRANSCRIPTION_FAILED` with a friendly message; network throw → same 502. The mock orchestrator returns a deterministic transcript even for invalid media (existing behavior), so the path is hermetic.
    5. Return `{ transcript, objectName }`.
  - Wire `StorageClient` via the existing storage module import (check how async-video module imports it — mirror that).
- **Controller:** `POST /cand/practice/:id/turn-audio` — `@HttpCode(200)`, `x-recovery-token` header like `turn`. Declare ABOVE `@Post(':id/turn')` is not needed (different literal path) but keep adjacent for readability.
- **Recording ref on the transcript (replay later):** extend `PracticeTurnBody` with optional `recordingRef?: string`; `practice.service.turn()` stores it in the new transcript row's `answer_data` as `{ recording: body.recordingRef }` (column exists, currently unused). Validate: if present must be a string ≤ 500 chars (the object name we returned).
- **Shared types:** `PracticeTurnAudioBody { audioBase64: string; contentType?: string }`, `PracticeTurnAudioResponse { transcript: string; objectName: string }`; add `recordingRef?: string` to `PracticeTurnBody`.
- **Pricing/consent:** nothing new — `mode 'voice'` already exists on `practice_session` and `priceForKind('voice') === 2`; the audio endpoint works on any `live` session, the UI only offers it for voice mode. Consent page already requires the recording checkbox.

### A2. Integration spec — `practice-voice.integration.spec.ts`

Queue-isolated `bootApp`. Flow: candidate signup → create **voice** session (library pack) → consent (`recordingAllowed: true`) → preflight → **assert debit is exactly 2** (voice price; `SELECT reason, delta FROM credit_ledger …`) → `POST turn-audio` with a small base64 payload (fake webm bytes are fine — mock orchestrator still returns its fixture transcript; assert `transcript` is a non-empty string) → `POST turn` with `{ answer: transcript, recordingRef: objectName }` → 200 → assert `practice_transcript.answer_data->>'recording' === objectName` → run to wrapup → report completed. Also: employer token on `turn-audio` → 403; audio on a non-live session → 409; bad base64 → 400.

### A3. Ascend UI

- `api.ts`: `submitPracticeAudio(sessionId, recoveryToken, body)` → the new endpoint; `submitPracticeTurn` gains optional `recordingRef`.
- `PracticeSetupPage`: enable the Voice card (2 credits, selected state like Text); JD flow uses the selected `mode` (currently hardcoded `'text'`).
- `PracticeInterviewPage`: when `session.mode === 'voice'`, below the question card render a recorder block:
  - Record / Stop buttons via `MediaRecorder` (`audio/webm;codecs=opus`, fallback `audio/mp4`), timer display, permission-denied error line.
  - On stop: base64 the blob → `submitPracticeAudio` → show "Transcribing…" → put `transcript` into the **existing editable textarea** (user can correct STT mistakes) → keep `objectName` in state → `handleSubmit` passes `recordingRef: objectName`.
  - Text mode unchanged.
- Unit tests: recorder flow mocked (`MediaRecorder` stubbed on window; mock `submitPracticeAudio` resolving `{transcript: '…', objectName: 'practice-recordings/…'}`); setup page voice selection test.
- E2E: new `apps/ascend-web/e2e/practice-voice.spec.ts` — golden journey with voice mode. Playwright must launch chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (add to `playwright.config.ts` launchOptions). Fake mic records silence; MediaRecorder still produces a real webm; the mock STT returns the fixture transcript; assert the transcript lands in the editable box, submit, report renders, wallet chip shows −2 (50 → 48). Rebuild the ascend-web image before running (rule 9).

### A4. Gate

API suite + ascend-web unit + e2e green; lint/typecheck clean. Commit + `--no-ff` merge.

✅ **DONE 2026-09-23** — merge `a768da4` (branch commit `0243735`).
Evidence: API 361 passed (incl. 3 new voice integration specs); ascend-web 33
unit passed (+4 new); voice e2e golden journey passed (13.9s, wallet 50→48);
text practice e2e regression passed; ruff/mypy/eslint/tsc clean on touched
packages. Bug found at gate: MediaRecorder sends `audio/webm;codecs=opus` —
fixed by matching the bare MIME; regression test added.

---

## Branch B — `phase-12b/resume-pdf-parsing` — document extraction port

### B1. Orchestrator (`services/ai-orchestrator/app/documents/`)

- `pip install` path: add `pypdf>=5` to `pyproject.toml` dependencies and `uv lock` (commit the lockfile).
- `ports.py`: `DocumentTextExtractor` protocol — `async def extract(self, data: bytes, content_type: str) -> str`.
- `pypdf_extractor.py`: `application/pdf` → `pypdf.PdfReader(io.BytesIO(data))`, concatenate page `.extract_text()`, raise `ExtractionError` (4xx-family typed error, message "pdf text extraction failed: …") when no text layers or corrupt. `text/*` → decode utf-8 (errors replaced).
- `mock_extractor.py`: `text/*` → decoded passthrough (so api tests stay hermetic without pypdf); `application/pdf` → a canned fixture profile text (deterministic); other types → error.
- `service.py`: adapter factory from `DOCUMENT_EXTRACTION_ADAPTER` (default `mock`, `pypdf` for real) — mirror the `STT_ADAPTER` factory pattern.
- `router.py`: `POST /documents/extract-text`, pydantic body `{content_base64: str, content_type: str}` (base64 validated, ≤ 25 MB), response `{text: str, extractor: str}`. Typed errors like the analysis router (2xx/4xx/5xx, never 200-with-fake).
- `main.py`: `include_router(documents_router)`.
- Tests: router/service tests — mock passthrough, pdf fixture returns canned text, corrupt pdf (pypdf mode) → 4xx, oversize → 4xx, health of the endpoint. Fixture: a tiny real PDF generated in-test via pypdf writer or a committed base64 constant.

### B2. API (`services/api/src/modules/resume/`)

- New thin client `DocumentExtractionClient` (mirror `AsyncVideoTranscriptionService`: lazy `ORCHESTRATOR_URL`, POST `/documents/extract-text`, non-2xx → 502 `EXTRACTION_FAILED`).
- `resume.service.upload`: when `body.text` is absent/empty, call the extraction client with `contentBase64` + contentType (sniff: `application/pdf` when fileName ends `.pdf` else `text/plain`), use returned text as the parse input. Validation order unchanged (fileName + contentBase64 still required).
- Store the real contentType on the `candidate_resume` row (already a column) — `'application/pdf'` for PDFs, `'text/plain'` for pasted text.
- `shared-types`: no contract break — `CandidateResumeRequest` stays `{fileName, contentBase64, text?}` (`text` now truly optional).

### B3. Ascend UI (`ResumePage`)

- Add a file picker (accept `.pdf,.txt`) above the paste area: read via `FileReader` → base64 → `uploadResume({fileName, contentBase64})` (no `text`). Paste flow unchanged. Show "Extracting text from your PDF…" while uploading. Errors: extraction failure → friendly line "We could not read that PDF — paste the text instead."

### B4. Tests

- Orchestrator pytest new tests (B1) — 104 → target ~110.
- API integration (`resume-pdf` cases in the resume integration spec or new spec): upload a tiny real PDF (minimal base64 PDF constant — a one-page PDF with extractable text, generate once via pypdf and inline the base64) → 201, parsed profile present, row contentType `application/pdf`; corrupt-bytes pdf → 502 or 4xx mapped (assert non-201 + error code); text upload still works unchanged.
- ascend-web unit: file-picker upload path (mock `uploadResume` without `text`).
- Contract: api client + orchestrator router must agree on the shape (test both sides).

### B5. Gate

Orchestrator suite + ruff + mypy strict; API suite; ascend-web unit; lint/typecheck; rebuild compose (`docker compose build ai-orchestrator api ascend-web && up -d`) and re-run ascend e2e (resume e2e + practice e2e). Commit + `--no-ff` merge.

✅ **DONE 2026-09-23** — merge `ddb0ff6` (branch commit `cf22231`).
Evidence: orchestrator 118 passed / 2 skipped (14 new extraction specs);
API 364 passed (3 new PDF integration specs, shared `tiny-resume.pdf`
fixture); ascend-web 34 unit passed (+1 PDF upload test); full ascend e2e
4/4 passed (incl. new PDF journey: file picker → extraction → ATS card);
ruff/mypy strict/eslint/tsc clean. Bug found at gate: NUL-byte sniffing
cannot tell a small PDF from text — content-type decision is now
file-name-driven (.pdf → extraction port, else printable-text heuristic).
compose runs `DOCUMENT_EXTRACTION_ADAPTER=pypdf` (mock remains the
env-unset default for contract tests).

---

## Final — docs + close-out

1. `docs/STATE.md`: build matrix counts, new gap rows removed (voice practice UI + pdf parsing now shipped), Phase 12b note in the Ascend section.
2. `CONTEXT.md`: feature status (deferrals closed), test counts, gotcha (MediaRecorder mimeType fallbacks; fake-media playwright flags; orchestrator mock STT returns fixture even for invalid media — don't assert transcript content from audio, only non-emptiness).
3. This file: tick A/B gates with evidence; note the deliberate non-goal (real-time LiveKit conversational voice stays a later drop — this is record-transcribe-submit only).
4. **No new phase tag** — this is a beta drop on top of `phase-12-complete`; record as a follow-up merge. Do not tag `v0.2.0-pilot` (still Phase 11).

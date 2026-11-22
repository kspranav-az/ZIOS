# Plan — Practice/Interview UX Fixes + Live STT/Camera Wiring

**Goal mode plan.** Single workstream, one branch. Written to be executed with
low thinking effort: every step names exact files, decisions are pre-made
(see §0), and nothing requires re-analysis.

**The gap this closes:** five reported defects in the candidate-facing surfaces,
all root-caused on 2026-11-22:

1. **Voice practice transcription is hardcoded mock** — every recording returns
   *"I think the most challenging part was aligning the team."* regardless of
   speech. Root cause: `/video/transcribe` builds `AsyncVideoTranscriptionService()`
   with no `stt` argument and the constructor defaults to `MockSttAdapter()`
   (`services/ai-orchestrator/app/video/transcription_service.py:48`), bypassing
   the STT factory. `STT_ADAPTER=gcp` is set and boots correctly for the voice
   router, but this path never sees it.
2. **Voice practice forces a record → see transcript → edit → submit loop** the
   user doesn't want — transcribe silently and auto-submit.
3. **Live captions show raw STT text** in voice/video rooms (3 pages) — hide them
   (transcription still happens server-side for scoring).
4. **Video-mode camera is optional** — a denied/busy camera silently degrades to
   audio-only ("Camera unavailable" warning is easy to miss) and integrity
   snapshots stop. Camera must be required for video/live modes with fail-fast.
5. **Text-mode layout**: single `max-w-3xl` column with the full history stack
   above the question card → constant scrolling after each answer, ~75% dead
   horizontal margin on wide screens. Both `InterviewPage` (candidate-web) and
   `PracticeInterviewPage` (ascend-web) share this flaw.

Plus one feature gap: **practice setup accepts JD as paste-only text**; no JD
file (PDF/TXT) upload, even though the orchestrator document-extraction port
already exists (used by resume upload).

**Sequencing note:** fully independent of `plans/password-auth-and-team-management.md`,
`plans/external-sso-and-oauth.md`, and `plans/employer-invite-ui-and-email.md`
(different modules, different pages). No rebase needed either way.

---

## 0. Decisions already made (do not re-litigate)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Fix STT wiring at the `/video/transcribe` route**, not in the service default. Build the adapter once at module boot in `video/router.py` via `build_stt_adapter(load_settings())` (mirroring `voice/router.py:37`) and pass it into `AsyncVideoTranscriptionService(stt=...)`. Leave the `MockSttAdapter()` constructor default in place so tests that inject nothing still work. | Smallest change; factory is the single adapter-selection point; boot-time failure on bad `STT_ADAPTER` matches voice router behavior. |
| D2 | **Voice practice auto-submits the transcript, no editing.** On successful transcription: keep the transcript in state, call the submit path immediately with `recordingRef`, show "Submitting your answer…". On transcription failure: show the error and reveal the textarea so the candidate can type instead (existing `recorderError` pattern). The recorder panel copy changes to reflect the new flow. | Explicit user request ("do transcribe but don't show to user"). |
| D3 | **Live captions hidden, not removed.** Keep the `onCaption` callback wired (it costs nothing and aids future debugging) but render nothing in the 3 live pages. Delete the visible caption markup and unused caption state in each page. | STT still runs server-side for scoring; captions were a debug aid leaking into UX. |
| D4 | **Camera is required for video-mode rooms; voice stays mic-only.** Add `requireCamera?: boolean` to `ConnectRoomSessionOptions` (default false). When true, camera failure throws instead of falling back to mic-only; pages catch and show a hard error state ("A working camera is required for this interview — check the browser permission and that no other app is using it") with a Retry button. Candidate `VideoInterviewPage` and ascend `PracticeLivePage` pass `requireCamera: true`. Before the LiveKit connect, pages run a probe `navigator.mediaDevices.getUserMedia({ video: true })` and stop the tracks, so the permission prompt appears early with clear context. | Video mode without video silently breaks integrity snapshots (webcam_snapshot every 15s captures nothing) — that was the "not being asked and analysed" symptom. |
| D5 | **Two-pane layout on wide screens, collapsible history on narrow.** Both text pages: container widens to `max-w-6xl`; at `lg:` a 2-column grid — left (5/12): question card + input + submit, `lg:sticky lg:top-6`; right (7/12): transcript list, `max-h-[70vh] overflow-y-auto`, chronological with auto-scroll to bottom. Below `lg`: single column, history renders as a collapsed section showing only the last exchange plus a "Show full transcript (N)" toggle. Textarea stays `rows={6}`. Pure Tailwind, no new dependencies, same `@zios/ui` components. | Fixes both the scrolling and the dead-margin complaints without inventing a new design language. |
| D6 | **JD upload reuses the existing extraction port.** New API route `POST /cand/practice/extract-jd` (`{fileName, contentBase64}` → `{text}`) in the practice module, calling `DocumentExtractionClient` (`services/api/src/modules/resume/document-extraction.client.ts`) — imported via `ResumeModule` exports (add `DocumentExtractionClient` to its `exports` if not already). Same size/type limits as resume upload. Frontend: file input (`.pdf,.txt`) on `PracticeSetupPage` next to the JD textarea; on extract success, fill `jdText` with a "Review and edit the extracted text" hint; on failure, show the existing error style and keep paste fallback. | No new extraction capability — the port already handles text/plain + pypdf. |
| D7 | Single branch `fix/practice-interview-ux-live-wiring`, small conventional commits, merge with `git merge --no-ff` (commits preserved — never squash). Commit via `git commit --no-verify --no-gpg-sign -F /tmp/msg.txt`. Merge commit message must start with a conventional type (husky commit-msg runs on merges). After the orchestrator rebuild, **verify the fix is inside the image** before re-testing (a failed amd64 build silently keeps the old image). | Same git/dev rules as every prior phase. |

## Out of scope (explicit)

- Candidate interview (employer-invited) answer upload — an interview is live answers only; no change.
- Per-mock resume picker (resume stays account-wide, one active) — separate decision.
- AI video analysis (gaze/presence inference) — integrity remains observable-signals-only per AGENTS.md invariants.
- Captions as a user-toggleable accessibility feature — if wanted later, it's a prop flip.
- `AsyncConsentPage` / `AsyncVideoInterviewPage` (record-upload mode) — untouched except they share the fixed `/video/transcribe` path and get real transcripts for free.

---

## Current state (what you're building on)

- Orchestrator: `app/video/router.py` (`POST /transcribe`, constructs `AsyncVideoTranscriptionService()` bare); `app/video/transcription_service.py` (`__init__` line 48 defaults `stt or MockSttAdapter()`); `app/analysis/stt/factory.py` (`build_stt_adapter(settings)` → mock|gcp); `app/voice/router.py:37` shows the boot-time pattern to copy; `app/voice/mock_stt.py:24-25` holds the fixture string. Container env already `STT_ADAPTER=gcp`, `GCP_PROJECT_ID=promptwars-497703`; boot log confirms `adapter=gcp`. Port 8000 is the Docker container (no stray host process).
- API: `services/api/src/modules/practice/practice-audio.service.ts:85` calls `{orchestrator}/video/transcribe`; `services/api/src/modules/resume/document-extraction.client.ts` (`extract(contentBase64, contentType)` → orchestrator `/documents/extract-text`); resume module (`resume.controller.ts` `POST /cand/resume`) is the template for D6.
- Candidate-web: `pages/InterviewPage.tsx` (`max-w-3xl` line 287, history block 295–308, textarea 270–278); `pages/VoiceInterviewPage.tsx` (caption render line 200); `pages/VideoInterviewPage.tsx` (caption 329–333, camera warning 308–312, passes `videoElement` line 160); `components/VideoRecorder.tsx` (async mode, unrelated).
- Ascend-web: `pages/PracticeInterviewPage.tsx` (`max-w-3xl` line 231, history 240–253, recorder panel 269–306, `setAnswer(result.transcript)` line 191, submit carries `recordingRef` lines 119–122); `pages/PracticeLivePage.tsx` (caption block, passes `videoElement` line 80); `pages/PracticeSetupPage.tsx` (`jdText` state, min-length gate `jdText.trim().length < 40` line 148, `createPracticeFromJd({jdText, mode})` line 65); `pages/ResumePage.tsx` (`uploadResume` → `POST /cand/resume`, base64 pattern to copy).
- Shared package: `packages/interview-room/src/room-session.ts` (`connectRoomSession`, camera fallback lines 61–85, `onCameraWarning`); caption source is the `onCaption` callback of `openOrchestratorSocket`.
- Tests: `services/api/src/testing/integration/practice-voice.integration.spec.ts` (mock orchestrator returns fixture transcript — keep green); `apps/ascend-web/src/pages/PracticeInterviewPage.test.tsx` (mocks `submitPracticeAudio`, asserts transcript-in-textarea — **must be reworked for D2**); candidate-web `InterviewPage` has no layout test today.
- Env: `.env` already correct (`STT_ADAPTER=gcp`); `.env.example` gets the same keys documented if missing.

---

## Step 1 — Orchestrator: route `/video/transcribe` through the STT factory (D1)

- `services/ai-orchestrator/app/video/router.py`:
  - Import `build_stt_adapter` and `load_settings` (see `app/voice/router.py:16,37`).
  - At module boot: `_stt_adapter = build_stt_adapter(load_settings())`; construct `AsyncVideoTranscriptionService(stt=_stt_adapter)` inside `transcribe_video`.
  - Update the route docstring ("mock by default" → "configured STT_ADAPTER").
- **Do not** change `transcription_service.py` behavior beyond what D1 needs; keep the `MockSttAdapter()` default so existing unit tests stay hermetic.
- Rebuild: `docker compose up -d --build ai-orchestrator` (~3 min, amd64-emulated). Then **verify the fix is in the image**: `docker exec zios-ai-orchestrator grep -n "build_stt_adapter" app/video/router.py` must print a line. Boot log must show `stt_adapter_selected adapter=gcp`.
- `.env.example`: confirm `STT_ADAPTER`, `GCP_PROJECT_ID`, `GCP_LOCATION`, `GCP_STT_CONFIG` are documented; add if absent.
- Tests: `pnpm --filter ai-orchestrator test` (or its pytest equivalent — use the repo's orchestrator test command) — the mock-injected tests still pass; nothing asserted the bare default.

## Step 2 — Ascend: voice practice auto-submits, no transcript editing (D2)

- `apps/ascend-web/src/pages/PracticeInterviewPage.tsx`:
  - `transcribeRecording`: on success, store `{transcript, objectName}` in state (new `pendingSubmission` state), do **not** `setAnswer(result.transcript)`, then invoke the submit path automatically.
  - Refactor `handleSubmit` to accept an optional `{answer, recordingRef}` override so the auto path reuses it (single source for history push + wrapup navigation).
  - Recorder panel copy: recording → "Recording… speak your answer, then stop."; transcribing → "Transcribing your answer…"; done → panel collapses to the normal question view with "Submitting…" handled by the button loading state.
  - On transcription error: existing `recorderError` + **reveal the textarea** (set a `recorderFailed` flag that switches the voice panel into "type your answer instead" mode).
  - In voice mode the textarea is no longer the primary surface: render it only when `recorderFailed` or when no recording flow has started yet (keep it visually secondary/optional — final call during implementation: hide it entirely in voice mode unless transcription failed).
- `PracticeInterviewPage.test.tsx`: rework the audio-flow test — mock `submitPracticeAudio` resolving `{transcript, objectName}` and assert `submitPracticeTurn` is called with `{answer: transcript, recordingRef: objectName}` and the transcript is **not** displayed in a textarea. Keep the failure-path test (error shown, textarea usable).
- Manual smoke after Step 1+2 land: run a voice mock, say something distinctive ("The quick brown fox…"), confirm the report/judge sees the real words and the UI never shows an editable transcript.

## Step 3 — Candidate + Ascend: hide live captions (D3)

- `apps/candidate-web/src/pages/VoiceInterviewPage.tsx` — remove the caption paragraph (line ~200) and the `caption` state/`onCaption` wiring.
- `apps/candidate-web/src/pages/VideoInterviewPage.tsx` — remove caption block (lines 329–333) and state/wiring.
- `apps/ascend-web/src/pages/PracticeLivePage.tsx` — same caption block removal.
- Keep everything else (InterviewerBubble, controls) untouched. Unit tests referencing captions, if any, drop those assertions.

## Step 4 — Interview-room: camera required for video modes (D4)

- `packages/interview-room/src/room-session.ts`:
  - Add `requireCamera?: boolean` to `ConnectRoomSessionOptions` (default `false` — voice behavior unchanged).
  - In the catch path: if `wantsCamera && opts.requireCamera`, rethrow a typed error (`CameraRequiredError`) instead of falling back to mic-only. Otherwise keep the current warning fallback.
- `apps/candidate-web/src/pages/VideoInterviewPage.tsx` and `apps/ascend-web/src/pages/PracticeLivePage.tsx`:
  - Before `connectRoomSession`, probe: `const probe = await navigator.mediaDevices.getUserMedia({video:true}); probe.getTracks().forEach(t=>t.stop());` — fail fast into a friendly error card ("Camera is required… check permission / close other apps") with a Retry button that re-runs the effect (extract the start function so it can be re-invoked).
  - Pass `requireCamera: true` into `connectRoomSession`.
- `packages/interview-room/src/interview-room.test.tsx`: add a case — camera rejection with `requireCamera:true` rejects; without it, warns and continues mic-only (existing behavior).

## Step 5 — Candidate + Ascend: two-pane text layout (D5)

- `apps/candidate-web/src/pages/InterviewPage.tsx` and `apps/ascend-web/src/pages/PracticeInterviewPage.tsx` (keep the two pages structurally mirrored, as the ascend header comment already intends):
  - Container: `max-w-3xl` → `max-w-6xl px-4`.
  - `lg:` and up: `grid grid-cols-12 gap-6`; question card in `lg:col-span-5` with `lg:sticky lg:top-6 self-start`; transcript column `lg:col-span-7` with `max-h-[70vh] overflow-y-auto pr-1` and auto-scroll to bottom on new history item (`useEffect` + ref `scrollIntoView({behavior:'smooth'})`).
  - Below `lg`: history collapses — render only the last item plus a button "Show full transcript (N)" toggling the full list. Question card stays on top (current order).
  - Keep all existing behaviors: draft autosave, answer-draft restore, structured question types (rating/mcq render inside the left card), wrapup navigation, error display. The refactor is markup-only — no logic moves except the collapse toggle state.
- Verify `pnpm --filter candidate-web test` and `pnpm --filter ascend-web test` stay green (existing tests target logic/behavior, not layout classes).

## Step 6 — Ascend: JD file upload in practice setup (D6)

- API — `services/api/src/modules/practice/`:
  - Shared types (`packages/shared-types/src/index.ts`): `PracticeExtractJdBody {fileName, contentBase64}`, `PracticeExtractJdResponse {text}`.
  - `practice.controller.ts`: `@Post('extract-jd')`, candidate plane (mirror existing practice route guards), body size/content validation identical in spirit to `resume.controller.ts` (`POST /cand/resume`).
  - New thin `practice-extraction.service.ts` (or a method on the practice service): validate extension/MIME (`.pdf` → `application/pdf`, `.txt` → `text/plain`), delegate to `DocumentExtractionClient.extract`, return `{text}`; map failures to the same 502 `EXTRACTION_FAILED` shape resume uses.
  - `practice.module.ts`: import `ResumeModule` and ensure `DocumentExtractionClient` is in `ResumeModule` exports (add if missing).
  - Integration test: `practice-jd-extract.integration.spec.ts` alongside the existing practice specs — mock orchestrator returns text for a fake PDF payload; 400 on bad base64; 400 on unsupported type; 502 path when orchestrator rejects. Auth: employer token → 403 (pattern from `practice-voice.integration.spec.ts:90-99`).
- Ascend-web — `apps/ascend-web/src/pages/PracticeSetupPage.tsx`:
  - `api.ts`: `extractPracticeJd(body)` → `POST /cand/practice/extract-jd`.
  - File row above the JD textarea: "…or upload a JD file" + hidden `<input type="file" accept=".pdf,.txt">`; `fileToBase64` copied from `ResumePage.tsx:41-50`; on success `setJdText(text)` + hint "Extracted from <name> — review and edit before starting"; on error, inline error + paste fallback untouched. Disable the input while extracting.
  - Unit test in `PracticeSetupPage.test.tsx`: file chosen → `extractPracticeJd` mocked → textarea populated; error → error shown.

## Step 7 — Docs, gates, merge

- `CONTEXT.md`: add the `/video/transcribe` mock-default caution ("bare `AsyncVideoTranscriptionService()` always mocks — always pass `stt`") and the "verify the fix is inside the rebuilt image" reminder.
- Docs: `docs/` — note real STT in practice voice + JD upload in the relevant feature doc if one lists practice capabilities (grep for the practice feature list; update only what exists).
- Full gates: `pnpm --filter api test`, `pnpm --filter candidate-web test`, `pnpm --filter ascend-web test`, orchestrator pytest, lint + typecheck on touched packages, `docker compose up -d --build ai-orchestrator candidate-web ascend-web`, then `node scripts/verify-live-e2e.js` (17 checks) and a manual smoke of: voice practice (real transcript, auto-submit), live practice (camera prompt, no captions), text practice + candidate text interview (two-pane, no-scroll regression).

---

## Execution order (commits)

Branch `fix/practice-interview-ux-live-wiring` from `main`.

1. `fix(orchestrator): route /video/transcribe through the STT adapter factory` — Step 1. Body: root cause (bare service construction defaulted to MockSttAdapter, ignoring STT_ADAPTER), the boot-time factory pattern copied from voice router, image-verification note.
2. `feat(ascend-web): auto-submit voice practice answers without transcript editing` — Step 2. Body: D2 rationale, test rework note.
3. `refactor(candidate-web,ascend-web): hide live STT captions in voice and video rooms` — Step 3.
4. `fix(interview-room): require camera for video-mode rooms with fail-fast error` — Step 4. Body: integrity snapshots depend on a live camera track; voice rooms unchanged.
5. `refactor(candidate-web,ascend-web): two-pane interview layout with collapsible transcript` — Step 5. Body: fixes scroll-per-answer and dead-margin on wide screens; markup-only, no logic changes.
6. `feat(api,ascend-web): upload JD files in practice setup via extraction port` — Step 6. Body: reuses DocumentExtractionClient; new extract-jd route + tests.
7. `docs: record STT factory caution and practice UX changes` — Step 7 docs commit (CONTEXT.md + any feature-doc list).

Then gates, `git merge --no-ff` with message
`fix: merge practice/interview UX and live wiring branch` (conventional prefix —
husky commit-msg runs on merge commits), push SSH remote.

## Risk notes

- **Step 1 is the only behavior change with blast radius beyond practice**: async-video interviews (`AsyncVideoInterviewPage`) share `/video/transcribe` and will now hit real GCP STT — that is the intended fix, but if GCP credentials lack STT scope the failure mode is a thrown error, not a mock transcript. Verify with one async-video submission in the smoke pass.
- **Step 2 changes a tested contract** (transcript-in-textarea). The rework is confined to one test file; keep the submit payload contract (`{answer, recordingRef}`) identical.
- **Step 4 probe + LiveKit both request camera** — the probe's tracks are stopped immediately, so LiveKit re-acquires; no double-permission prompt in practice (browser caches the grant), but note it in the smoke checklist.

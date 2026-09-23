# Phase 12e — Live Practice Rooms (Option B), Candidate Interview History, Responsiveness (goal plan)

**Companion to:** `phases/phase-12c-livepath-ai-wiring-chrome.md` (merged `62a1fa3`, incl. 12d sanitize/overflow/report-dedupe fixes)
**Created:** 2026-09-24 · **Execution mode: thinking LOW — this file is the spec.**
**Branch:** `phase-12e/practice-live-history-responsive` (cut from `main`), squash-forbidden, `--no-ff` merge, Conventional Commits via `git commit --no-verify -F /tmp/msg.txt`.

## Why this phase exists (evidence)

1. **Ascend practice screens are not real interview screens** (user report, 2026-09-24). Practice = text / voice-record turns via `/cand/practice/:id/turn[-audio]`; company interviews = full LiveKit voice/video (`apps/candidate-web/src/pages/{Voice,Video}InterviewPage.tsx`, `room.connect(url, token)`). Skills practiced ≠ skills tested. Decision: **Option B** — run Ascend practice through LiveKit with the orchestrator as AI interviewer agent, reusing the proven company-interview machinery.
2. **No candidate interview history** — `ProgressPage.tsx` shows practice mocks only. Schema verified: `candidate_account.email` ↔ `candidate.email` (via `invite.candidate_id → interview_session.invite_id`) is the only join key; neither side has a stored link today.
3. **Responsiveness is spotty** — kit builder right-edge cutoff was fixed in 12d (`min-w-0` on the grid track), but the same overflow pattern, unwrapped tables, and small touch targets exist elsewhere across all three apps.

**Global rules:** X8 consent before capture (practice already has `PracticeConsentPage` — reuse, never bypass); evidence-linked output only; provider independence behind ports (no vendor named in feature code); no auto-reject paths; `--no-ff` merges, never squash, no direct commits to `main`; hermetic tests with `DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos` inline; mock adapters keep tests free of real third-party credentials.

**Test commands:** API `DATABASE_URL=postgresql://interviewos:interviewos_dev@localhost:55432/interviewos pnpm --filter @zios/api test`; migrations `pnpm migrate`; ascend-web `pnpm --filter ascend-web test|e2e` (**rebuild the image before e2e** — playwright tests the image, not the tree); candidate-web `pnpm --filter candidate-web test|e2e` (same rebuild rule); employer-web `pnpm --filter employer-web test`; orchestrator `cd services/ai-orchestrator && uv run pytest` (+ ruff/mypy strict); typecheck each touched TS package with its `tsc -p tsconfig.json --noEmit` (the known pre-existing TS1343 in `resume-intelligence.integration.spec.ts` is the only allowed error).

**Traps carried from CONTEXT.md:** e2e runs hermetic with `LLM_MODE=mock` (recreate api after switching, restore gemini after); host orchestrator on port 8000 (`source services/ai-orchestrator/.env.host` first) — never let the stopped orchestrator container resurrect; `.env` duplicate-variable hazard (compose last-wins vs dotenv first-wins — never duplicate keys).

---

## Step 1 — Shared `packages/interview-room` (extract, then refactor candidate-web)

The room UI is duplicated-ready: candidate-web owns the only LiveKit screens. Extract before Ascend grows a divergent second copy (AGENTS.md rule 4 — copy the reference, don't invent).

1. Create `packages/interview-room/` following `packages/ui` conventions (vite build or plain tsc, exports typed). **Props-driven only — NO API client, NO auth, NO env imports.** Contents, lifted from `apps/candidate-web/src/pages/{Voice,Video}InterviewPage.tsx`:
   - `useRoomSession(opts: { url: string; token: string; onDisconnect?: (reason) => void })` — wraps `livekit-client` `Room`: connect, connection-state, publish mic/cam, remote participant tracks, reconnect handling. Both existing pages contain this logic inline — lift it, don't rewrite.
   - `<ConnectionBanner state={...} />`, `<MediaControls mic cam screen onToggle... onLeave />`, `<SelfView />`, `<ParticipantTile />` — visual port of the existing inline JSX using `@zios/ui` tokens only.
2. Refactor `VoiceInterviewPage.tsx` and `VideoInterviewPage.tsx` to consume the package. Behavior must be pixel-identical: the pages keep their own token fetching, WS signalling to the orchestrator (`/voice/sessions/:id/stream`), fallback-to-text logic, and telemetry. Only the room lifecycle + media UI moves.
3. `apps/candidate-web/package.json` gains `@zios/interview-room: workspace:*`; root `pnpm install`.
4. Tests: update any unit tests that touched moved internals; add one package-level test (hook renders, controls fire callbacks).

✅ **Gate:** `pnpm --filter candidate-web test` green; **candidate-web e2e 5/5 green after `docker compose build candidate-web`** (voice, video, async-video, recovery, integrity); tsc clean for candidate-web + the new package. If e2e breaks, the refactor changed behavior — stop and fix before Step 2.

---

## Step 2 — Live practice mode (orchestrator agent + API token + Ascend page)

Modes today: `'text' | 'voice'` (`practice.service.ts:58,80` rejects anything else). Add `'live'`.

### 2.1 API (`services/api/src/modules/practice/`)
- Extend `PracticeMode` with `'live'` in the shared types (find the existing union; keep `'voice'` = voice-record working unchanged).
- `POST /cand/practice` + `POST /cand/practice/from-jd`: accept `mode: 'live'` (same validation pattern as existing lines).
- New endpoint `POST /cand/practice/:id/live/token` in `practice.controller.ts`:
  - Guard: session belongs to the authenticated account (same ownership check as `GET /cand/practice/:id`), status is `consented`/`preflight` (mirror the company token endpoint's state checks), mode is `'live'`.
  - Proxies to the orchestrator `POST /voice/sessions/{practiceSessionId}/token` (existing router, `services/ai-orchestrator/app/voice/router.py:37`) — the orchestrator already signs LiveKit tokens and returns `{ livekit: {url, token}, wsUrl }`. Pass a `practice: true` flag in the body.
  - Return the orchestrator payload verbatim. 502 with the orchestrator's message if unreachable (fail loudly — never fabricate a token).

### 2.2 Orchestrator (`services/ai-orchestrator/app/`)
- `voice/router.py` `issue_voice_token`: accept the `practice` flag; thread it into `VoiceSessionService` as `kind: 'practice'`.
- Practice conductor persona: when `kind == 'practice'`, use a practice system prompt (pack title + questions + rubric context, same context the text/voice conductor builds today — find it in the API practice module and pass it in the token body) and **skip all company-only machinery**: proctoring/snapshots, integrity events, interview-notify callbacks. The agent behaves as interviewer only.
- On session end: post the final transcript turns to the API (`POST` to the practice transcript endpoint the text/voice path already uses — check `practice-transcript.repository.ts` for the write path; reuse it, don't create a parallel one). Judging then flows through the existing `practice-evaluation.service.ts` → report page unchanged.
- Mock adapters (`STT_ADAPTER=mock`) must carry a live practice session end-to-end hermetically.

### 2.3 Ascend (`apps/ascend-web/`)
- New `PracticeLivePage.tsx` at route `/practice/:sessionId/live`, registered in `App.tsx` as **immersive (no chrome)** — same exception list pattern as `/practice/:sessionId/interview` (12c Step 4). Flow: fetch session → `POST live/token` → `useRoomSession` from `@zios/interview-room` → WS to orchestrator stream URL → on complete, navigate to the existing `/practice/:sessionId/report`.
- `PracticeSetupPage.tsx`: mode picker gains a third option "Live voice & video (real interview room)" alongside text / voice-record. Live requires camera+mic permission preflight (mirror `PreflightPage.tsx` checks).
- `PracticeConsentPage.tsx`: unchanged — already stored consent; X8 invariant holds.

✅ **Gate:** (a) api unit + integration tests for the new token endpoint (ownership 403, wrong-status 409, mode mismatch 400, happy path with orchestrator stubbed); (b) orchestrator pytest for the practice persona + transcript postback (mock adapters); (c) **ascend e2e: live practice journey in `LLM_MODE=mock`** — setup → consent → preflight → room connects (dev LiveKit container) → conductor turn (mock STT) → report page renders with deduped quotes (12d). Rebuild images before e2e; restore api to gemini after. (d) By-hand gemini smoke once: one real live practice session via the UI with the host orchestrator running (`.env.host`) — capture connects, conductor speaks (mock TTS is fine), transcript lands, report generates.

---

## Step 3 — Candidate interview history (migration + endpoint + Progress UI)

### 3.1 Migration — `infra/migrations/migrations/<ts>_candidate-account-link`
Follow the existing file pattern in that directory (node-pg-migrate style, timestamp prefix like `1790105000000_candidate-accounts`).
- `ALTER TABLE candidate ADD COLUMN candidate_account_id uuid NULL REFERENCES candidate_account(id) ON DELETE SET NULL`
- `CREATE INDEX candidate_account_link_idx ON candidate(candidate_account_id)`
- Idempotent backfill in the same migration: `UPDATE candidate c SET candidate_account_id = ca.id FROM candidate_account ca WHERE c.candidate_account_id IS NULL AND lower(ca.email) = lower(c.email)` (exact-email match only — never fuzzy).
- `pnpm migrate` against the dev DB; verify with `\d candidate`.

### 3.2 Service (`services/api/src/modules/candidate-accounts/` or a small new `history` module — pick the smaller diff)
- Lazy link maintenance: inside the history query, before reading, upsert missing links for exact email matches (same SQL as the backfill). This avoids touching the invites module; links appear automatically.
- New `GET /cand/me/history` (controller: `candidate-accounts.controller.ts`, `@Controller('cand')` already exists). Response:
  ```json
  { "practice": [ /* existing progress session rows, unchanged shape */ ],
    "company": [ { "sessionId", "orgName", "roleTitle", "mode", "status",
                   "startedAt", "completedAt", "reportAvailable" } ] }
  ```
- `company` rows come from `candidate_account → candidate → invite → interview_session`, joining kit name via `kit_version_id → kit`. **Candidate-safe fields only.** `reportAvailable` is hardcoded `false` for now — full evaluation-report sharing from the candidate side is a separate product decision (employer-side evidence-linked reports default to not-shared; record this in docs close-out).

### 3.3 UI (`apps/ascend-web/src/pages/ProgressPage.tsx`)
- Fetch `/cand/me/history` instead of `/cand/practice/progress` (keep the old endpoint for compatibility; the new one supersedes it).
- Two clearly headed sections: **Practice mocks** (existing rows + report links) and **Company interviews** (new rows, read-only, status chip + org/role + date). Empty state for each section separately ("No company interviews linked to this email yet.").

✅ **Gate:** integration test with inline `DATABASE_URL`: seed account + candidate(same email, different case) + invite + completed session → history returns the company row; unmatched email → absent; employer token → 403. Unit tests for the service (link upsert idempotent). ascend-web unit + e2e green (progress page renders both sections).

---

## Step 4 — Responsiveness sweep (all three apps, mechanical)

Pattern source: 12d kit-builder fix (`min-w-0` on the `1fr` grid track — flex/grid children default to `min-width: auto`, content forces the track wider, shell `overflow-x-hidden` clips it).

1. **Grid audit:** every `grid-cols-[…_1fr]` / `lg:grid-cols-*` layout in `apps/*/src` — ensure the fluid track (or its inner card) has `min-w-0`; apply the same to flex rows with growing children.
2. **Tables:** any wide data table (wallet/credits ledger, list pages) gets `overflow-x-auto` on its wrapper, `min-w-*` on the table itself, and card-stacked rendering below `md:` where the reference design does so.
3. **Touch targets:** primary buttons/chips on mobile ≤768px meet ≥44px hit height; transcript/evidence chips wrap (`whitespace-normal`) instead of overflowing.
4. **Pages in scope (minimum):** Ascend — home, practice setup, practice live (Step 2 page), report, progress, wallet; employer — kits list, kit builder, generation, question bank; candidate — token landing, consent, preflight, interview pages.
5. **Playwright smoke:** one new e2e assertion per app at 360px viewport on the key pages above: `document.documentElement.scrollWidth <= window.innerWidth + 1` (no horizontal overflow).

✅ **Gate:** new overflow assertions pass; full unit + e2e suites green per app (images rebuilt first); visual by-hand pass at 360px and 768px on the pages in scope.

---

## Step 5 — Docs close-out + merge

- `CONTEXT.md`: add the `min-w-0` grid-overflow pattern to the gotcha list; note `live` practice mode depends on the orchestrator running (same port-8000 rule); note history linkage is exact-email only.
- `docs/STATE.md`: new rows for Step 2 (live practice), Step 3 (history), Step 4 (responsiveness); known-gaps updated (practice now exercises the LiveKit capture path on every run).
- `docs/manual-validation-checklist.md`: live-practice journey row + history visibility row.
- This file: tick every gate with evidence. No new phase tag — follow-up on `phase-12-complete` + 12b/12c/12d.
- Push branch + merge `--no-ff` to `main`; push `main`.

## Commits (suggested sequence)

1. `refactor(interview-room): extract shared livekit room package from candidate-web` (+ candidate-web refactor, +tests)
2. `feat(practice): live mode via orchestrator LiveKit room` — api token endpoint + mode extension (+tests)
3. `feat(orchestrator): practice interviewer persona, skip proctoring` (+pytest)
4. `feat(ascend): practice live page + mode picker` (+e2e)
5. `feat(candidate-accounts): interview history via exact-email link` — migration + endpoint (+tests)
6. `feat(ascend): company interview history section on progress` (+tests)
7. `fix(ui): responsiveness sweep — min-w-0 grids, table overflow, touch targets` (+e2e overflow smokes)
8. `docs: CONTEXT/STATE/checklist updates for phase 12e`

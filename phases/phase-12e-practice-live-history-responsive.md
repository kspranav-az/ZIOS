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

✅ **Gate:** `pnpm --filter candidate-web test` green (13/13); **candidate-web e2e 6/6 green after `docker compose build candidate-web`** (voice, video, async-video, recovery, integrity, 360px responsive smoke); tsc clean for candidate-web + the new package; interview-room package 9/9. Evidence: commits `91686d2` (package + refactor; the image rebuild landed the refactor before this gate passed).

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

✅ **Gate:** (a) api unit + integration tests for the new token endpoint (ownership 403, wrong-status 409, mode mismatch 400, happy path with orchestrator stubbed — `practice-live.integration.spec.ts`, green); (b) orchestrator pytest for the practice persona + transcript postback (mock adapters — `tests/test_practice_client.py`; suite 121 passed / 2 skipped, ruff + mypy strict clean); (c) **ascend e2e: live practice journey in `LLM_MODE=mock`** — setup → consent → preflight → room connects (dev LiveKit container) → conductor turn (mock STT) → report page renders (`practice-live.spec.ts`, green in the 5/5 ascend e2e run after image rebuild); images rebuilt before e2e; api restored to gemini after. (d) ⏳ **By-hand gemini smoke pending the owner** — one real live practice session via the UI with the host orchestrator running (`.env.host`, `--reload`); recorded as the open validation item in docs/STATE.md §5 + §8. Evidence: commits `69da841` (api), `31f1f2a` (orchestrator), `0dfbc34` (ascend page + picker).

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

✅ **Gate:** integration test with inline `DATABASE_URL` (`candidate-history.integration.spec.ts`): seed account + candidate (same email, different case) + invite + completed session → history returns the company row; unmatched email → absent; employer token → 403; idempotent link re-run; green. Unit spec pins the SQL contract (exact-email citext guard) + candidate-safe mapping (2 tests). ascend-web unit 39/39 (ProgressPage both sections incl. separate empty states) + e2e 5/5 green. `reportAvailable` hardcoded `false` — recorded as a product decision in docs/STATE.md (candidate-side report sharing is separate scope). **Note:** the read model lives in its own `modules/history/` module — candidate-accounts → practice imports were a JS circular import that broke app boot. Evidence: commits `c6e68f7` (api), `8448971` (UI).

---

## Step 4 — Responsiveness sweep (all three apps, mechanical)

Pattern source: 12d kit-builder fix (`min-w-0` on the `1fr` grid track — flex/grid children default to `min-width: auto`, content forces the track wider, shell `overflow-x-hidden` clips it).

1. **Grid audit:** every `grid-cols-[…_1fr]` / `lg:grid-cols-*` layout in `apps/*/src` — ensure the fluid track (or its inner card) has `min-w-0`; apply the same to flex rows with growing children.
2. **Tables:** any wide data table (wallet/credits ledger, list pages) gets `overflow-x-auto` on its wrapper, `min-w-*` on the table itself, and card-stacked rendering below `md:` where the reference design does so.
3. **Touch targets:** primary buttons/chips on mobile ≤768px meet ≥44px hit height; transcript/evidence chips wrap (`whitespace-normal`) instead of overflowing.
4. **Pages in scope (minimum):** Ascend — home, practice setup, practice live (Step 2 page), report, progress, wallet; employer — kits list, kit builder, generation, question bank; candidate — token landing, consent, preflight, interview pages.
5. **Playwright smoke:** one new e2e assertion per app at 360px viewport on the key pages above: `document.documentElement.scrollWidth <= window.innerWidth + 1` (no horizontal overflow).

✅ **Gate:** new 360px overflow assertions pass in all three apps (`document.documentElement.scrollWidth <= window.innerWidth + 1` on the golden journeys — commit `5137c25`); grid audit verified the 12d `min-w-0` pattern holds on every `grid-cols-[…_1fr]` layout; wallet ledger + report chips have `overflow-x-auto` / wrapping; Button md/lg hit ≈45px+ (the ~32px `sm` size is a deliberate scope call, unchanged). Full suites green per app on rebuilt images: employer unit 102/102 + e2e 12 passed **with 1 pre-existing failure** (`jd-generation.spec.ts` — deterministic on main: mock fixture returns 12 questions over 7 distinct topics, review UI groups by topic → 11 regenerate buttons vs 12 asserted; `git diff main...HEAD` proves 12e touches no generation/employer code — documented in docs/STATE.md §5, fix deferred); candidate-web unit 13/13 + e2e 6/6; ascend-web unit 39/39 + e2e 5/5; api 377 passed / 2 skipped.

---

## Step 5 — Docs close-out + merge

- ✅ `CONTEXT.md`: 12e gotchas added (stale no-`--reload` port-8000 orchestrator, playwright multi-app container trap, `min-w-0` grid pattern, citext-vs-node-pg param cast, module-cycle rule, pre-existing jd-generation failure); header + feature status + test state + known gaps + next steps updated.
- ✅ `docs/STATE.md`: Phase 12e evidence section; build-table counts refreshed (api 377, orchestrator 121, ascend 39/5, candidate 13/6, employer 102 + the pre-existing e2e failure); known-gaps rows (12e shipped, gate-(d) smoke, jd-generation failure, capture-path narrowing); git hygiene + next steps updated.
- ✅ `docs/manual-validation-checklist.md`: live-practice journey row + history visibility row in §5; snapshot bumped.
- ✅ This file: every gate ticked with evidence (Step 1 → `91686d2`, Step 2 → `69da841`/`31f1f2a`/`0dfbc34`, Step 3 → `c6e68f7`/`8448971`, Step 4 → `5137c25`, lint fixes → `d301f69`). No new phase tag — follow-up on `phase-12-complete` + 12b/12c/12d, per this file.
- ✅ `LLM_MODE=gemini` restored in `.env` and api force-recreated after the mock-mode e2e runs.
- ✅ Branch pushed; `--no-ff` merge to `main`; `main` pushed.

## Commits (suggested sequence)

1. `refactor(interview-room): extract shared livekit room package from candidate-web` (+ candidate-web refactor, +tests)
2. `feat(practice): live mode via orchestrator LiveKit room` — api token endpoint + mode extension (+tests)
3. `feat(orchestrator): practice interviewer persona, skip proctoring` (+pytest)
4. `feat(ascend): practice live page + mode picker` (+e2e)
5. `feat(candidate-accounts): interview history via exact-email link` — migration + endpoint (+tests)
6. `feat(ascend): company interview history section on progress` (+tests)
7. `fix(ui): responsiveness sweep — min-w-0 grids, table overflow, touch targets` (+e2e overflow smokes)
8. `docs: CONTEXT/STATE/checklist updates for phase 12e`

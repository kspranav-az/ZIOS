# Plan — Employer Report Page Fixes (timeline, details, override dropdown) + Dashboard Wiring

**Goal mode plan.** Single workstream, one branch. Written to be executed with
low thinking effort: every step names exact files, decisions are pre-made
(see §0), and nothing requires re-analysis.

**The gaps this closes** (all verified 2026-11-22 against the seeded async-video
session `62d3e951…`):

1. **Candidate timeline shows all "Pending"** on a finished, reported
   interview. Root cause: `sortTimelineStages` (`apps/employer-web/src/pages/reports/report-utils.ts:136`)
   looks up the session status in the 5-stage array
   `['invited','consented','preflight','live','completed']` — but the session's
   real status is `reported` (`SessionStatus` also allows `scoring`, `reviewed`,
   `abandoned`; `packages/shared-types/src/index.ts:751`), so `indexOf` returns
   -1 and no stage is ever marked done/active.
2. **"Interview details" shows Started = Completed = scoring time.** The card
   renders `report.startedAt`/`report.completedAt` — the *evaluation pipeline*
   timestamps (identical to the second for stub scoring), not the interview's.
   The session's real `started_at` (13:37) lives on `interview_session`;
   `ended_at` is **NULL** because the async-video completion path advances
   `scoring → reported` with no extras (`async-video-interviews.service.ts:833-834`),
   unlike live sessions which set `endedAt` at completion
   (`sessions.service.ts:218`).
3. **Override "Reason code" is a free-text input** with a placeholder
   ("e.g. EVIDENCE_MISSED") that doesn't exist anywhere — the backend only
   accepts 5 codes (`override.service.ts:9-15`: `disagree_with_evidence`,
   `candidate_clarified`, `rubric_misapplied`, `technical_misunderstanding`,
   `other`), so following the placeholder's suggestion yields a 400.
4. **Dashboard is 100% hardcoded zeros.** `DashboardPage.tsx` renders literal
   `0` for every stat/pipeline stage and a static greeting sentence (its own
   header comment admits: "Live data arrives with the candidates/interviews
   phases"). A backend `GET /dashboard/interviews` (paginated list) exists and
   is used by `InterviewsListPage`, but **no aggregate endpoint exists** for the
   dashboard's stats, pipeline, greeting counts, or upcoming list.

**Sequencing note:** independent of all queued plans. Touches employer-web
(report pages + DashboardPage) and `evaluation` (dashboard controller, override
codes) + `async-video-interviews` (one-line ended_at fix). No overlap with
`plans/employer-invite-ui-and-email.md` (Candidates page / invites module).

---

## 0. Decisions already made (do not re-litigate)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Timeline util takes terminal statuses into account.** New signature `sortTimelineStages(status, { startedAt })`. Mapping: `completed`/`scoring`/`reported`/`reviewed` → all 5 stages done (the green "Report" node already renders separately via `hasReport`). `abandoned` → stages done up to `live` if `startedAt` is set, else up to `consented`; render a red terminal "Abandoned" node instead of the report node. | Matches the state machine (`sessions/state-machine.ts`); honest about what we know for abandoned sessions. |
| D2 | **Details card shows interview time, not scoring time.** "Started" = `session.startedAt`, "Completed" = `session.endedAt ?? report.completedAt`. The page already fetches the session row via `dashboardApi.listInterviews` (`InterviewDetailPage.tsx:73-81` — `row.session` carries `started_at`/`ended_at` from the dashboard query) — no API payload change needed, just thread the two fields into component state. | Correct labeling with zero backend surface change. |
| D3 | **`ended_at` is set when the async-video session enters `scoring`.** In `async-video-interviews.service.ts`, pass `{ endedAt: new Date() }` on the `advanceStatus(q, session, 'scoring')` call only (the candidate has finished answering at that point). Live/text paths already set it; do not touch them. Historical NULL rows: acceptable (D2's fallback covers display). | One-line fix at the exact transition; scoring→reported stays unset to avoid overwriting. |
| D4 | **Reason code becomes a shared-enum `<select>`.** Move `OVERRIDE_REASON_CODES` into `packages/shared-types/src/index.ts` (as a const array + union type); backend `override.service.ts` imports it (deleting its local copy — single source of truth); the dialog renders a `<select>` with human labels (Disagree with evidence / Candidate clarified / Rubric misapplied / Technical misunderstanding / Other), defaulting to empty "Select a reason…" option, required before Save. Delete the misleading placeholder. | Typo-proof UI; backend validation unchanged in spirit. |
| D5 | **Dashboard gets a real aggregate endpoint.** `GET /dashboard/summary` in `dashboard.controller.ts`, org-scoped, returning: `stats {totalCandidates, activeJobs, totalInterviews, pendingReviews}`, `pipeline {sourced, applied, screening, technical, final, offers}` (cumulative counts over session statuses), `timeToHireDays` (avg `ended_at::date − invite.created_at::date` over terminal sessions; null → UI shows "—"), `awaiting[]` (top 5 sessions in `invited`/`consented`/`preflight` with candidate name, mode, status, created_at). | The controller already runs org-scoped dashboard SQL — extending it keeps one module; cumulative pipeline maps honestly onto the statuses we actually have (no fake ATS stages). |
| D6 | **Greeting copy changes to what we can truthfully say.** "You have {pendingReviews} interviews pending score review and {liveNow} in progress." — no calendar/scheduling data exists, so don't claim "scheduled today". The "Upcoming interviews" section heading stays, content = `awaiting[]` with per-row status; empty state stays as today. | No fabricated scheduling feature; copy matches data. |
| D7 | `activeJobs` = count of kits owned by the org (label already says "Active Jobs"; kits are the closest entity). If a kit list query doesn't exist in this controller's module, count via `kit` table by org_id. | Cheapest truthful mapping; revisit when jobs become a real entity. |
| D8 | Single branch `fix/employer-report-dashboard`, small conventional commits, merge with `git merge --no-ff` (commits preserved — never squash). Commit via `git commit --no-verify --no-gpg-sign -F /tmp/msg.txt`. Merge commit message must start with a conventional type (husky commit-msg runs on merges). | Same git rules as every prior phase. |

## Out of scope (explicit)

- The flag-disposition dialog's reason handling (`InterviewDetailPage.tsx:726-781`) — it already uses a constrained code (`false_positive` cast, `DispositionReasonCode` exists in shared-types). Only fix if its options are also free-text (check during Step 3; do not redesign).
- Candidate pipeline as a real ATS (arbitrary stages) — the cumulative status mapping is the honest v1.
- Scheduling/calendar for interviews — copy now avoids claiming it.
- Editing/removing overrides, override history UI — untouched.

---

## Current state (what you're building on)

- `apps/employer-web/src/pages/reports/report-utils.ts` — `sortTimelineStages` (line 136, the buggy lookup), `SESSION_STATUS_LABELS`, tested by `report-utils.test.ts:111`.
- `apps/employer-web/src/pages/reports/InterviewDetailPage.tsx` — fetches `reportsApi.getDetail`, `dashboardApi.listInterviews`, `integrityApi.listFlags` (lines 73-81); session row provides status/mode/conductor today; timeline render at lines 284-330; details card at ~340-360 (uses `report.startedAt/completedAt`); override dialog at ~610-700 (free-text reason input at 670-681).
- `services/api/src/modules/evaluation/override.service.ts:9-15` — `VALID_REASON_CODES` local const (moves to shared-types in D4); validation at line 38.
- `services/api/src/modules/evaluation/dashboard.controller.ts` — `GET /dashboard/interviews` with the org-scoped join pattern to copy for D5 (`interview_session s JOIN invite i … JOIN candidate c …`).
- `services/api/src/modules/async-video-interviews/async-video-interviews.service.ts:833-834` — the `scoring`/`reported` advances; `advanceStatus` (line ~863) forwards extras to `SessionsRepository.updateStatus` (`sessions.repository.ts:117-140`, `endedAt` support already built in).
- Shared types: `SessionStatus` (`shared-types/src/index.ts:751`), `DashboardInterviewItem`, `DispositionReasonCode` (:1220). Add `OVERRIDE_REASON_CODES`, `OverrideReasonCode`, `DashboardSummaryResponse`.
- `apps/employer-web/src/lib/dashboard-api.ts` — client for `listInterviews`; add `getSummary` beside it.

---

## Step 1 — Timeline fix (D1)

- `report-utils.ts`: new `sortTimelineStages(status, opts: { startedAt?: string | null })` per D1; export a `TimelineStage` type. Keep the old behavior for in-progress statuses (`invited`…`completed` unchanged).
- `report-utils.test.ts`: add cases — `reported`/`reviewed`/`scoring` → all done; `abandoned` with startedAt → invited/consented/preflight/live done + abandoned terminal; `abandoned` without startedAt → invited/consented done; existing in-progress cases stay.
- `InterviewDetailPage.tsx`: thread `sessionStartedAt`/`sessionEndedAt` from `row.session` into state; pass `{startedAt}` to the util; render the red "Abandoned" terminal node when status is `abandoned` (report node only when `hasReport`).
- Smoke: open the seeded reported session — all 5 stages checked + green Report node.

## Step 2 — Details timestamps (D2, D3)

- `async-video-interviews.service.ts:833`: `advanceStatus(q, session, 'scoring', { endedAt: new Date() })`. Add/adjust an integration assertion that a completed async-video session has `ended_at` set.
- `InterviewDetailPage.tsx` details card: Started = `state.sessionStartedAt`; Completed = `state.sessionEndedAt ?? report.completedAt` (fallback label unchanged). Keep the Status badge as-is.
- Smoke: re-seed async session → Started shows the real interview start, Completed the finish (distinct from scoring time on stub path since ended_at is set at completion, not at report generation).

## Step 3 — Override reason dropdown (D4)

- `packages/shared-types/src/index.ts`: add `export const OVERRIDE_REASON_CODES = ['disagree_with_evidence','candidate_clarified','rubric_misapplied','technical_misunderstanding','other'] as const; export type OverrideReasonCode = typeof OVERRIDE_REASON_CODES[number];` (+ `OverrideReasonCode` replaces the inline `string` type on `ScoreOverride.reasonCode` if it was `string`).
- `override.service.ts`: import from shared-types, delete local const (keep the 400 message, now generated from the imported list).
- `InterviewDetailPage.tsx` override dialog: `<select>` with empty disabled "Select a reason…" option + the 5 labeled options; Save disabled until chosen; remove placeholder text. Labels map kept next to the dialog.
- Backend spec (`override.service.spec.ts`) — unchanged expectations; add one assertion that the error message lists all shared-enum codes if cheap.
- Smoke: open override popup → dropdown with 5 options → save works; previously-typed invalid codes impossible.

## Step 4 — Dashboard summary endpoint + wiring (D5, D6, D7)

- `dashboard.controller.ts`: `@Get('summary')` returning `DashboardSummaryResponse` per D5. SQL (all org-scoped via `i.org_id = $1`, one query per group or a few small queries — clarity over cleverness):
  - totalCandidates: `COUNT(DISTINCT i.candidate_id) FROM invite i WHERE i.org_id=$1`
  - activeJobs: `COUNT(*) FROM kit k WHERE k.org_id=$1`
  - totalInterviews: `COUNT(*) FROM interview_session s JOIN invite i … WHERE i.org_id=$1`
  - pendingReviews: sessions with status `'reported'`
  - pipeline cumulative: six counts with status filters (`>=` in state-machine order)
  - timeToHireDays: `AVG(s.ended_at::date - i.created_at::date)` over sessions with `ended_at` not null
  - awaiting: top-5 sessions `status IN ('invited','consented','preflight')` ordered by `s.created_at DESC` with candidate name + mode + status
- Shared types: `DashboardSummaryResponse`.
- `lib/dashboard-api.ts`: `getSummary()`; `DashboardPage.tsx`: fetch on mount, render real numbers; greeting sentence per D6; pipeline widths as percentage of `sourced` (0 → bars at 0%); empty states preserved when counts are 0.
- Integration test: seed org with known shapes (reuse sandbox seed patterns) → assert each summary field; 401 unauthenticated; cross-org isolation (second org sees zeros).
- Frontend test: mock `getSummary` → assert stats/pipeline/awaiting render; zero-response → empty states.
- Smoke: seeded sandbox org dashboard shows real counts; greeting line reflects pending reviews.

## Step 5 — Gates, docs, merge

- Gates: `pnpm --filter employer-web test`, `pnpm --filter api test` (unit + integration), lint + typecheck on touched packages, `docker compose up -d --build api employer-web`, `node scripts/verify-live-e2e.js`, plus the per-step smokes above.
- Docs: feature docs that mention the dashboard/report page get a one-line refresh only if they explicitly describe these sections (grep first; don't invent doc edits).
- Merge `--no-ff` with conventional-prefixed message, push SSH remote.

---

## Execution order (commits)

Branch `fix/employer-report-dashboard` from `main`.

1. `fix(employer-web): derive report timeline for terminal and abandoned session statuses` — Step 1.
2. `fix(api,employer-web): record async-video ended_at and show interview times in report details` — Step 2.
3. `fix(employer-web,api): dropdown for score override reason codes from shared enum` — Step 3.
4. `feat(api,employer-web): aggregate dashboard summary endpoint and wiring` — Step 4.
5. `docs: employer dashboard/report fix notes` — only if Step 5 finds doc lines to update.

## Risk notes

- `DashboardInterviewItem.session` shape: confirm `startedAt`/`endedAt` are mapped in the dashboard controller's row mapper before relying on D2 (the SQL selects them; if the mapper drops them, add the two fields — still no contract break, additive).
- The report page currently throws if the session is missing from the first 100 dashboard rows (`InterviewDetailPage.tsx:78`); D4's summary work doesn't touch this, but note it — a future fix is a direct session endpoint.
- Pipeline percentages divide by `sourced`; guard division-by-zero (all zeros → all bars 0%).

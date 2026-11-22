# Plan — Employer Candidate-Invite UI (single + bulk CSV + invite roster) + Invite Email

**Goal mode plan.** Single workstream, one branch. Written to be executed with
low thinking effort: every step names exact files, decisions are pre-made
(see §0), and nothing requires re-analysis.

**The gap this closes:** the entire candidate-invite backend already exists and
is tested (`POST /invites`, `POST /invites/bulk`, list/detail/reissue/reschedule,
OTP, reminders), but the employer dashboard has **no UI that calls any of it** —
the only working "send a link" surface today is the machine-facing `POST /v1/interviews`
API. Candidates page is a hardcoded empty state; no invite email exists.

**Sequencing note:** independent of `plans/password-auth-and-team-management.md`
(different modules — `invites` vs `auth`; different pages — `CandidatesPage` vs
`TeamPage`/`LoginPage`). No rebase needed either way. Either can land first.

---

## 0. Decisions already made (do not re-litigate)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Backend changes are minimal and additive.** The only service change is (a) one joined list query + (b) optional invite email on create/reissue. `POST /invites`, `POST /invites/bulk`, OTP, token hashing, reminders — all untouched. | The API is already correct; this plan is ~90% UI. |
| D2 | **Single UI entry point: the Candidates page becomes the invite hub.** Header gains a "Send interview" button opening a dialog with two tabs: **Single candidate** (form) and **Bulk CSV** (file upload). `InterviewsListPage` empty-state CTA ("Invite candidates to a kit to see them here.") links to `/candidates`. Kit builder gains **no** invite UI — publish flow stays clean. | One obvious place beats three half-places; matches the reference design's Recruiter→Candidates structure already ported in `CandidatesPage.tsx`. |
| D3 | **Kit selection inside the dialog:** kit dropdown (`kitsApi.list`) → version dropdown (`kitsApi.listVersions(kitId)`, only `status === 'published'` versions selectable). The invite binds to a `kitVersionId` (immutable snapshot) — never to a draft kit. | FR-E2-5: reports must reference the exact definition used. |
| D4 | **Link display + copy is the primary "delivery" mechanism; email is the convenience.** After create/reissue, show the full candidate-web URL with a copy button. The raw token exists only in that response — the roster can never re-display an old link, only reissue a new one. The UI must say this explicitly ("This link is shown once"). | Matches the token contract: hash-only storage, raw token returned once. |
| D5 | **Invite email via the existing `EMAIL_SENDER` port** (`services/api/src/modules/notifications/email-sender.port.ts`, Mailpit adapter in dev). Single create: optional `notify: boolean` on the body, default **true** (a human sending an interview wants the candidate to receive it). Bulk: always email successfully created rows. Reissue: always email the new link. Email failure is **non-fatal** — log and continue; the API response still carries the link. Provider independence preserved (port, not Mailpit, is injected). | The reminders cron already assumes "the link they already received" — this makes that true. Non-fatal because Mailpit-in-dev must never block an invite. |
| D6 | **Roster = invites, not a new "candidates" abstraction.** Candidates page table lists invites (newest first) with candidate name/email, kit title + version, status, expiry, created date, and row actions: **Copy new link (reissue)**, **Extend expiry (+7 days via reschedule `extendDays`)**, and **View** (detail drawer → `GET /invites/:id`, includes kit snapshot + session/consent state for debugging). The old fake `STATUS_OPTIONS` filter is replaced by a real status filter over invite statuses (`invited`, `in_progress`, `completed`, `expired`). | No new table, no new read model — `invite` already tracks status and lifecycle. |
| D7 | **`GET /invites` response is enriched in place** (same `{ invites: [...] }` envelope; each item gains `candidate: {id, name, email}` and `kit: {id, title, version}`) via a new joined repository query `listByOrgWithCandidate`. Nothing consumes the slim shape except integration tests, which assert fields that still exist — they keep passing. | Avoids N+1 `getDetail` per row from the UI. |
| D8 | **CSV contract (bulk tab):** client parses nothing — `multipart/form-data` with `file` field, `?kitVersionId=` query param, exactly what `POST /invites/bulk` already accepts (`FileInterceptor('file')`). Provide a **Download template** button serving a static `name,email,phone,external_ref` header CSV. After upload show `total / successes / errors` and an inline per-row error list. | Server already validates per row (`CsvParserService`) and returns `BulkInviteResponse`. |
| D9 | **Frontend env:** add `VITE_CANDIDATE_BASE_URL` (default `http://localhost:5174`) to employer-web, mirroring the backend's `PUBLIC_CANDIDATE_BASE_URL` (`v1-interviews.service.ts:60-62`). Used to build the copyable link client-side. Compose override for employer-web adds it; `.env.example` updated. | One source of truth per app; backend keeps its own for emails. |
| D10 | Single branch `feat/employer-invite-ui`, small conventional commits, merge with `git merge --no-ff` (commits preserved — never squash). Commit via `git commit --no-verify --no-gpg-sign -F /tmp/msg.txt`. Merge commit message must start with a conventional type (husky commit-msg runs on merges). | Same git rules as every prior phase. |

## Out of scope (explicit)

- Editing candidate details or a true ATS pipeline (Applied/Screening/Hired statuses) — the roster is invite-lifecycle only.
- Candidate self-registration / public application links — separate product decision.
- Reschedule-by-candidate-request flow (`live-rooms-api.ts` already has a `reschedule-request` stub) — untouched.
- Webhook on invite creation — Phase 11 territory.
- Any change to the candidate-side flow (`/i/start`, token resolution, OTP) — untouched.

---

## Current state (what you're building on)

- `services/api/src/modules/invites/` — `invites.controller.ts` (all routes, employer + public planes), `invites.service.ts` (`create` returns `{invite, candidate, token}`; `bulkCreateWithKitVersionId` per-row results; `reissue` returns new token, refuses `completed`; `reschedule` takes `extendDays` or `expiresAt`), `invites.repository.ts` (`listByOrg` is slim — no joins; `findPendingForReminders` shows the exact join pattern to copy for D7), `csv-parser.service.ts`, `reminders.service.ts`.
- Email: `services/api/src/modules/notifications/email-sender.port.ts` (`EMAIL_SENDER` symbol, `EmailSender.send({to, subject, text})`), `mailpit-email.adapter.ts`, exported from the module (`exports: [EMAIL_SENDER, OTP_SENDER]`). `InvitesModule` must import `NotificationsModule` (or receive `EMAIL_SENDER` via the existing module import graph — check `invites.module.ts` first; reminders already injects `EMAIL_SENDER`, so the import exists).
- `InvitesService.create` runs inside `db.transaction` — the email send must happen **after** commit (fetch candidate email inside the txn, send after), never inside.
- Shared types: `CreateCandidateInviteBody`, `CreateCandidateInviteResponse`, `BulkInviteResponse`, `Invite`, `InviteListResponse`, `ReissueInviteBody`, `RescheduleInviteBody` — all in `packages/shared-types/src/index.ts`.
- Employer-web: `apps/employer-web/src/pages/shell/CandidatesPage.tsx` (hardcoded empty state, fake filter — replace), `InterviewsListPage.tsx` (real data via `dashboardApi.listInterviews`, empty-state CTA exists), `lib/api.ts` (`API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'` — same env pattern for D9), `lib/kits-api.ts` (`list`, `listVersions`), shell nav already includes Candidates (`ShellLayout.tsx:10`). No `invites-api.ts` client exists — create one.
- `scripts/verify-live-e2e.js` exercises `POST /invites` directly (line 186) — proves the API contract this UI speaks.
- Reference design: `AI-Interview-Platform/` (git-ignored clone) `pages/Recruiter/Candidates.jsx` — the source the empty page was ported from; keep visual language consistent with it and current shell pages.

---

## Step 1 — Backend: enriched invite list (D7)

- `services/api/src/modules/invites/invites.repository.ts`:
  - Add `listByOrgWithCandidate(orgId, q)` — copy the join shape from `findPendingForReminders` (lines 154–191): `invite i JOIN candidate c ON c.id = i.candidate_id JOIN kit_version kv ON kv.id = i.kit_version_id JOIN kit k ON k.id = kv.kit_id`, select candidate name/email, kit title, version number, order `i.created_at DESC`.
- `services/api/src/modules/invites/invites.service.ts`: `list()` returns the joined rows mapped to a new `InviteListItem` type.
- `packages/shared-types/src/index.ts`: add `InviteListItem` (extends `Invite` minus `tokenHash` — never leak the hash; adds `candidateName`, `candidateEmail`, `kitTitle`, `kitVersion`); change `InviteListResponse` to `{ invites: InviteListItem[] }`.
- Update `invites.controller.ts` `list()` return type. Existing integration spec (`invites.integration.spec.ts`) — run it; only fix if it asserted the absence of new fields (it won't).

## Step 2 — Backend: invite email (D5)

- `services/api/src/modules/invites/invites.service.ts`:
  - Inject `EMAIL_SENDER` (same `@Inject(EMAIL_SENDER)` pattern as `reminders.service.ts:22`). If `InvitesModule` doesn't already import `NotificationsModule`, add it (check first).
  - Add private `sendInviteEmail(candidate: {name, email}, kitTitle: string, token: string)` — builds `${process.env.PUBLIC_CANDIDATE_BASE_URL ?? 'http://localhost:5174'}/?token=<token>`, subject `"Your interview invitation"`, plain-text body with name, kit title, link, expiry date, unsubscribe footer (reuse `RemindersService.unsubscribeUrl`). Wrap in try/catch — catch logs (`console.warn`) and swallows (non-fatal, D5).
  - `create()`: accept `notify?: boolean` (default true). After the transaction commits, if `notify` → fetch kit title via `kitVersions.findById` (already loaded in txn — pass it out) → `sendInviteEmail`. **Do not send inside the txn.**
  - `reissue()`: always send the new token after commit.
  - `bulkCreateWithKitVersionId()`: after commit, send for every row that has a `token` (success rows); failures inside the per-row loop must not abort other emails — each send individually try/caught.
- `packages/shared-types/src/index.ts`: `CreateCandidateInviteBody` gains optional `notify?: boolean`. `CreateCandidateInviteResponse` unchanged (token already present).

## Step 3 — Employer-web: invites API client + dialog

- New `apps/employer-web/src/lib/invites-api.ts`:
  - `create(body: CreateCandidateInviteBody)` → `POST /invites`
  - `bulk(kitVersionId, file: File)` → `POST /invites/bulk?kitVersionId=…` with `FormData` (must **not** JSON-encode — check `apiFetch` in `lib/api.ts`; if it only supports `json`, add a `formData` option or use raw `fetch` with the same error handling)
  - `list()` → `GET /invites`
  - `reissue(id)` → `POST /invites/:id/reissue`
  - `extend(id, days)` → `POST /invites/:id/reschedule` `{ extendDays: days }`
  - `detail(id)` → `GET /invites/:id`
  - `candidateLink(token)` → `${import.meta.env.VITE_CANDIDATE_BASE_URL ?? 'http://localhost:5174'}/?token=${encodeURIComponent(token)}`
- New `apps/employer-web/src/pages/shell/SendInterviewDialog.tsx` (D2, D3, D8):
  - Tab 1 **Single**: kit select (from `kitsApi.list()`, exclude archived) → version select (`kitsApi.listVersions`, published only, default latest) → name / email / phone / external ref → optional expiry days (default 7) → "Send & show link" submit.
  - Tab 2 **Bulk CSV**: same kit/version pickers → file input (`.csv` only) → "Download template" (static blob with header `name,email,phone,external_ref`) → upload → result summary (`{total, successes, errors}`) + inline error rows.
  - Success state (both tabs): full link shown in a read-only input + **Copy link** button (`navigator.clipboard`, with `copied` feedback) + explicit "This link is shown once — copy it now" note + "Send another" reset. Bulk success: collapsible list of created links (one per row, each with its own copy button — the response `results[]` carries `token` per success row).
  - Styling: copy the `InviteDialog.tsx` shell (overlay, `rounded-3xl` card, `Input` from `@zios/ui`, same success iconography) — this is the teammate dialog's visual sibling.
- Reuse `userMessageForError` from `lib/errors.ts` for all API errors.

## Step 4 — Employer-web: Candidates page roster (D6)

Rewrite `apps/employer-web/src/pages/shell/CandidatesPage.tsx`:

- Header: "Candidates" + count (`{visible} of {total} invites shown`) + **Send interview** button (opens `SendInterviewDialog`).
- Toolbar: search input (filters client-side over name/email/kit title — same pattern as `filterDashboardInterviews` in `lib/dashboard-api.ts`) + status chips (real invite statuses from the data, replacing the fake `STATUS_OPTIONS`).
- Table columns: Candidate (name + email) · Kit (title + `v{version}`) · Status (chip, map: `invited`→neutral, `in_progress`→info, `completed`→success, `expired`→outline) · Expires (date; red when <48h) · Actions.
- Row actions: **Copy new link** (confirm popover: "The old link stops working. The candidate gets a new email." → `reissue` → show new link in the dialog's success state) · **Extend +7d** (immediate `extend`, toast confirm) · **View** (slide-over detail: `detail()` → candidate, kit snapshot summary, session/consent presence flags).
- Data: `invitesApi.list()` on mount + after any dialog success; `toast.push(..., 'success')` on mutations (toast pattern already used in `KitBuilderPage.tsx`).
- `InterviewsListPage.tsx` empty state: wrap the existing text in a link to `/candidates`.

## Step 5 — Env + docs

- `apps/employer-web/.env.example` (create if absent): `VITE_API_URL=http://localhost:3000`, `VITE_CANDIDATE_BASE_URL=http://localhost:5174`.
- Compose dev override (where `VITE_API_URL` is already injected for employer-web — find it in `docker-compose*.yml`): add `VITE_CANDIDATE_BASE_URL=http://localhost:5174`. Rebuild employer-web image after.
- Docs: `services/api/src/modules/invites/README.md` (email behavior + enriched list), `docs/external-api-and-data-contract.md` (`GET /invites` shape change, `notify` field), `docs/STATE.md` (invite email now exists — reminders page `/i/start` fallback note can stay), `CONTEXT.md` if anything new bites.

## Step 6 — Tests

- **API unit/integration**:
  - `listByOrgWithCandidate` maps joined rows; response never contains `tokenHash` (assert key absence).
  - `create` with `notify: true` and fake `EmailSender` → email sent post-commit with link containing raw token; with `notify: false` → no email; email adapter throwing → invite still created, response intact (D5 non-fatal).
  - `reissue` sends email with the **new** token; `completed` invite → 409 (existing).
  - Bulk: mixed valid/invalid CSV → counts + per-row errors; every success row triggers an email (fake sender capture), one failing adapter doesn't stop the rest.
  - Existing suites: `invites.integration.spec.ts`, `reminders` tests — all must stay green.
- **Employer-web unit** (vitest, mirror `auth.test.tsx` mocking pattern): `invites-api` builds FormData for bulk (assert no `Content-Type: json`); dialog validation (bad email, no kit selected); link builder URL-encodes token.
- **E2E** (Playwright, candidate golden journey exists): employer flow — login → Candidates → Send interview (single) → copy link → open link in new context → consent → complete one text question → back in employer, invite status becomes `completed`. Reuse the seeded org/kit helpers from existing e2e specs.
- **Hermetic rule:** fake `EmailSender` in all tests; Mailpit only in manual verification.

**Verification gate:** `pnpm --filter api test` green; `pnpm --filter employer-web test` green; lint + typecheck green; `docker compose up -d --build api employer-web` → stack healthy; manual: send single + bulk from UI, verify Mailpit (`localhost:8025`) shows invite emails with working links, open one link → interview works; re-run `scripts/verify-live-e2e.js` (API contract unchanged apart from additive fields — must stay 17/17 green).

---

## Execution order (single branch `feat/employer-invite-ui`)

1. Step 1 enriched list (+ types, tests) → commit `feat(invites): joined invite list with candidate and kit summary`.
2. Step 2 invite email (+ types, tests) → commit `feat(invites): optional invite email via email sender port`.
3. Step 3 invites-api client + SendInterviewDialog → commit `feat(employer-web): send interview dialog with single and bulk CSV invite`.
4. Step 4 CandidatesPage roster + InterviewsListPage CTA → commit `feat(employer-web): invite roster on candidates page with reissue and extend`.
5. Step 5 env + docs → commit `docs: invite email, enriched invite list, candidate base url env`.
6. Step 6 remaining tests + e2e → commit `test(invites,employer-web): invite ui and email coverage`.
7. Full gates (Step 6 verification block), then merge: `git checkout main && git merge --no-ff feat/employer-invite-ui -F <conventional msg>` (e.g. `feat(invites): employer invite ui and invite email`) → push `origin main` (SSH). If merge aborts on husky: complete with `git commit --no-verify --no-gpg-sign -F <file>`.

## Risks / watch-items

- **Token leak check (D7):** the enriched list query must not select `token_hash`, and the mapped `InviteListItem` must omit it — add an explicit absence assertion in the integration test. `GET /invites/:id` detail already returns no raw token (only `tokenHash`) — keep it that way; the UI's "Copy new link" must go through `reissue`, never surface a stored token.
- **Email inside transaction:** sending inside `db.transaction` (Step 2) would hold the txn open on Mailpit I/O and roll back the invite if Mailpit hiccups. Fetch what's needed in the txn, send after commit.
- **`apiFetch` FormData:** `lib/api.ts` currently JSON-encodes bodies — verify how it sets `Content-Type` before wiring bulk upload; a wrong content type yields the controller's `CSV file is required` 400 in a confusing way.
- **Bulk URL encoding:** `kitVersionId` goes in the query string (`?kitVersionId=`), the file in multipart — getting this backwards is the most likely wiring bug.
- **Version picker staleness:** after publishing a new version from the kit builder, the dialog's version list must refetch (it fetches on open — fine) and must not allow binding to a draft/unpublished version (`loadVersionForWrite` 404s cross-status? no — it accepts any version id; the UI is the guard, D3).
- **Rebuild discipline:** employer-web runs from the Docker image in compose — `docker compose up -d --build employer-web` after UI changes, then hard-refresh; a stale `index-*.css` 404 (seen before) means the image wasn't rebuilt.
- **Don't touch:** OTP flow, candidate-web, token resolution, reminders cron, `/v1/interviews` external API. The SSO/password plans are orthogonal.

# Plan — Admin Credit Top-up Endpoint + Ledger-Clean Seed Scripts

**Goal mode plan.** Single workstream, one branch. Written to be executed with
low thinking effort: every step names exact files, decisions are pre-made
(see §0), and nothing requires re-analysis.

**The gap this closes:** four scripts — `scripts/grant-credits.js`,
`scripts/seed-async-video-validation.js`, `scripts/seed-integration-sandbox.js`,
`scripts/seed-multimodal-analysis-validation.js` — top up org credit balances
with raw SQL (`UPDATE credit_account SET balance = balance + $1` +
`UPDATE org SET credits_balance …`) **outside** `CreditsService`, so no
`credit_ledger` row is written. Verified symptom (2026-11-22, employer Wallet):
ledger shows `+100 welcome_grant → balance 100` then `-3 async_video_created →
balance 1097` — a +1000 jump with no ledger row (the seed top-up). The product's
money path is correct (`adjustBalance` + `writeLedger` in one transaction,
`credits.service.ts:230-260`); only these scripts bypass it. Long-term, manual
admin top-ups need a real endpoint anyway — this builds that endpoint and routes
the scripts through it.

**Sequencing note:** independent of `plans/password-auth-and-team-management.md`,
`plans/external-sso-and-oauth.md`, `plans/employer-invite-ui-and-email.md`, and
`plans/practice-interview-ux-and-live-wiring.md` (credits module + scripts only).
No rebase needed either way.

---

## 0. Decisions already made (do not re-litigate)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Endpoint: `POST /credits/admin/topup`**, guarded by `@Roles('admin')` (same pattern as `PATCH credits/wallet/threshold`, `credits.controller.ts:38`). Body: `{amount: number, note?: string}`. Fixed ledger reason `admin_grant`; metadata `{grantedByUserId, note}`. Delegates to `CreditsService.credit(accountId, amount, reason, client, metadata)` (`credits.service.ts:163`) so balance, org cache, and ledger stay in one transaction. Response: `{balance, ledgerEntryId}`. | One write path for money; the service already does ledger + org-cache sync atomically. |
| D2 | **Top-up only — no admin debit.** `amount` must be an integer 1–1_000_000; anything else → 400. Negative adjustments happen only through product flows (interview creation, practice debits), never by hand. | Prevents typo-driven balance destruction; a grant is the only realistic manual op today. |
| D3 | **Scripts call the API with the admin session they already hold.** All four scripts authenticate via `/auth/otp/request` + `/auth/otp/verify` and keep the session token (e.g. `seed-async-video-validation.js:87-96`); the raw-SQL block is replaced with `postJson('/credits/admin/topup', {amount, note: '<script-name> seed'}, adminToken)`. `grant-credits.js` keeps its amount CLI arg. No DB credentials needed by scripts anymore for crediting (they still use DB for other seeding). | Removes the last un-audited write path with zero new auth machinery. |
| D4 | **Wallet UI unchanged.** The ledger table already renders `reason`, `delta`, `balance_after`, and `created_at` — `admin_grant` rows display correctly as-is. An admin-console button is a later, separate decision. | The endpoint is the contract; UI can come when the admin console exists. |
| D5 | Single branch `feat/admin-credit-topup`, small conventional commits, merge with `git merge --no-ff` (commits preserved — never squash). Commit via `git commit --no-verify --no-gpg-sign -F /tmp/msg.txt`. Merge commit message must start with a conventional type (husky commit-msg runs on merges). | Same git rules as every prior phase. |

## Out of scope (explicit)

- Admin console UI for top-ups (endpoint only; D4).
- Credits transfer between orgs, promo/coupon codes, Razorpay purchase — Phase 11 territory.
- Changing any product debit path — untouched.
- Backfilling ledger rows for past script top-ups — historical sandboxes only, not worth a migration.

---

## Current state (what you're building on)

- `services/api/src/modules/credits/credits.controller.ts` — `GET credits/wallet` (session-authed), `PATCH credits/wallet/threshold` (`@Roles('admin')` — the exact guard pattern to copy), `WalletResponse` shape.
- `services/api/src/modules/credits/credits.service.ts` — `ensureAccount(holderType, holderId)`, `getAccount`, `credit(accountId, amount, reason, q, metadata?)` (line 163; writes ledger via `writeLedger` with `balance_after` from `adjustBalance`), `listLedger`. Ledger insert at lines 258–262.
- Shared types: `AppUser` carries `orgId` + roles; `@CurrentUser()` / `@Roles()` decorators in `services/api/src/common/decorators`.
- Scripts (all in `scripts/`): the four files listed above contain `UPDATE credit_account`; each builds an admin session via OTP (`signupAdmin` helper pattern in `seed-async-video-validation.js:87-96`) and has a `postJson(path, body, token)` helper already.
- Integration test home: `services/api/src/testing/integration/` — `credits.*.spec.ts` exists (extend or add `credits-admin-topup.integration.spec.ts` alongside); role-guard 403 pattern exists across specs.

---

## Step 1 — Endpoint + service delegation (D1, D2)

- `services/api/src/modules/credits/credits.controller.ts`:
  - `@Post('admin/topup')` + `@Roles('admin')`.
  - Validate body: `amount` integer, 1–1_000_000; `note` optional string ≤ 200 chars (truncate or 400 — pick 400, consistent with threshold validation style).
  - `accountId = await this.credits.ensureAccount('org', user.orgId)`; call `credit(accountId, amount, 'admin_grant', client, {grantedByUserId: user.id, note})` — wrap in a transaction the same way `org.service.ts:28-32` does for the welcome grant; return `{balance, ledgerEntryId}` (have `credit` return the ledger entry id, or fetch the latest ledger row — prefer making `credit` return the entry id if it doesn't already; check its return shape first).
  - Import `Post` from `@nestjs/common`.
- Integration tests (`credits-admin-topup.integration.spec.ts`):
  - Admin session → 200, `balance` increased by amount, ledger row with `reason: 'admin_grant'`, correct `delta` and `balance_after`, `metadata.grantedByUserId` set; `org.credits_balance` cache matches.
  - Non-admin (member) session → 403; unauthenticated → 401.
  - `amount: 0` / `-5` / `1.5` / `2_000_000` / missing → 400; `note` > 200 chars → 400.
- Unit: controller validation edge cases if the controller has a spec file pattern — follow whatever `credits.controller.spec.ts` (if present) does.

## Step 2 — Scripts route through the endpoint (D3)

- `scripts/seed-async-video-validation.js`: replace the raw UPDATE block (lines ~144–153) with `postJson('/credits/admin/topup', {amount: 1000, note: 'seed-async-video-validation'}, adminToken)`. Keep the console output line.
- `scripts/seed-integration-sandbox.js`, `scripts/seed-multimodal-analysis-validation.js`: same replacement for their `UPDATE credit_account` blocks (amounts as currently parameterized).
- `scripts/grant-credits.js`: replace its credit block; keep CLI args (`node scripts/grant-credits.js <email> <amount>`); after the call, print the new balance from the response.
- Smoke after Step 1+2: run `node scripts/seed-async-video-validation.js`, open the admin wallet → ledger must show a single `+1000 admin_grant` row (plus the `+100 welcome_grant`), balance arithmetic fully explained by the ledger.

## Step 3 — Docs + gates + merge

- `CONTEXT.md`: add the caution — **"Never raw-UPDATE `credit_account` / `org.credits_balance` outside `CreditsService` — every balance movement must produce a `credit_ledger` row; use `POST /credits/admin/topup` for seeding and manual grants."**
- Gates: `pnpm --filter api test` (unit + integration), lint + typecheck on `services/api`, `docker compose up -d --build api`, `node scripts/verify-live-e2e.js` (17 checks — proves wallet/debit flows untouched).
- Merge `feat(admin-credits): merge admin top-up endpoint and ledger-clean seeds` style message (`--no-ff`), push SSH remote.

---

## Execution order (commits)

Branch `feat/admin-credit-topup` from `main`.

1. `feat(api): admin credit top-up endpoint with ledger audit` — Step 1. Body: D1/D2 rationale; one transaction via CreditsService.credit; metadata records granting admin.
2. `refactor(scripts): route seed credit grants through the top-up endpoint` — Step 2. Body: removes the last ledger-bypassing write path; all four scripts now audit via credit_ledger.
3. `docs: credit-account write-path caution` — Step 3 CONTEXT.md.

## Risk notes

- `CreditsService.credit` signature: if it currently returns `void`/balance rather than a ledger id, extending its return is additive — check its callers (`org.service.ts` welcome grant, practice debits) and keep them compiling; do not change their behavior.
- Scripts get the admin token **before** top-up in every case — verify the ordering stays (OTP login first, then top-up, then seeding) in each edited script.
- If a script runs against an older API image (not rebuilt), the top-up call 404s — the smoke checklist's `docker compose up -d --build api` before running scripts is not optional.

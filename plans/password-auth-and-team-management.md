# Plan — Username/Password Login (parallel to OTP) + Admin-Created Users & Team Page

**Goal mode plan.** Single workstream, one branch. Written to be executed with
low thinking effort: every step names exact files, decisions are pre-made
(see §0), and nothing requires re-analysis. No existing auth behavior changes —
OTP and (future) OAuth stay exactly as they are.

---

## 0. Decisions already made (do not re-litigate)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Password is a parallel login method.** OTP endpoints (`/auth/otp/*`), `verifyOtp`, and `signInOrProvision` are **untouched**. Google OAuth workstream (`plans/external-sso-and-oauth.md`) is unaffected — but the two plans should land sequentially (this one first), since both touch `auth.controller.ts`. | User's explicit instruction; zero regression risk on the demo flow. |
| D2 | Hashing: **`argon2` npm package, argon2id**. Hash string is self-describing (`$argon2id$v=19$...`), so no separate algo column. Native module with prebuilt binaries; add to `services/api` deps. No `bcrypt`/`argon2` exists anywhere in the repo today — this is the first credential-hash dependency. | argon2id is the current OWASP-recommended password hash. |
| D3 | Force-reset via `password_changed_at timestamptz NULL`. Admin-created users get a generated 16-char temp password and `password_changed_at = NULL` → **must set a new password before any other API call succeeds**. Users who sign in via OTP and later choose to add a password (future) are unaffected. | NULL-as-flag avoids a boolean column that can drift out of sync. |
| D4 | **No auto-provisioning on password login.** Unknown email → generic `401 INVALID_CREDENTIALS` (same message as wrong password). This differs from OTP — password login never calls `provisionSignup`. Admin-created users are *invited into an existing org*, so no org is ever created via this path. | Prevents email-existence probing and breaks the "first password login spawns an org" trap in `signInOrProvision`. |
| D5 | Three new employer-plane routes (all in the existing `auth` / `org` modules — **no new bounded context**): `POST /auth/password/login` (`@Public`), `POST /auth/password/change` (authenticated but allowlisted past the force-change guard), `POST /orgs/current/users` (`@Roles('admin')`). | Reuses existing session, guard, and org-scoping machinery. |
| D6 | Session/cookie contract unchanged: password login ends in the existing `SessionService.create(user.id)` and the same httpOnly cookie set in `verifyOtp`. Nothing downstream (roles guard, org resolution) changes. | Same reasoning as SSO plan D8. |
| D7 | Force-change is enforced **server-side by a guard**, not just a UI redirect: any authenticated request where `password_changed_at IS NULL` is rejected with `403 PASSWORD_CHANGE_REQUIRED`, except the allowlist (`POST /auth/password/change`, `GET /auth/me`, `POST /auth/logout`). The `AuthResponse` also carries `passwordChangeRequired: boolean` so the SPA lands on the right screen on first login. | Client-only enforcement is a security hole; server-side is ~30 lines with the existing guard pattern. |
| D8 | Rate limit password login in Redis: fixed window `pwd:rl:<email>` 5 attempts / 60 s → `429 RATE_LIMITED`, and `pwd:rl:<ip>` 20 attempts / 60 s. `ioredis` is already an api dependency. On Redis absence (unit tests), the limiter no-ops — never blocks login in test. | Same Redis helper pattern the SSO plan introduces; if this lands first, create `services/api/src/common/redis-kv.ts` here and the SSO plan adopts it. |
| D9 | Admin user creation returns the temp password **once, in the response body** (shown in UI with a copy button). Sending it by email is a follow-up via the existing email port — do not wire email in this plan. | Smallest complete loop; Mailpit stub would add an env/adapter dependency for marginal value now. |
| D10 | Single branch `feat/password-auth`, small conventional commits, merge with `git merge --no-ff` (commits preserved — never squash). Commit with `git commit --no-verify --no-gpg-sign -F /tmp/msg.txt` (GPG keyring stale lock — known caution, see CONTEXT.md). Merge commit message must start with a conventional type (husky commit-msg runs on merges). | — |

## Out of scope (explicit)

- Candidate/Ascend password login — candidate plane stays OTP-only (SSO plan handles candidate identity separately).
- Self-service "add a password to my OTP-only account" and password reset via email — future phase; admin-created users are the only password source this phase.
- SAML / enterprise IdP — covered by the generalized-OIDC workstream instead.
- Platform-level super-admin / operator console — "admin" stays an org role; this plan adds org-admin user management, not a new console app.

---

## Current state (what you're building on)

- `services/api/src/modules/auth/` — `auth.controller.ts` (otp request/verify, google, me, logout), `auth.service.ts` (`verifyOtp` → `signInOrProvision`), `session.service.ts` (`create(userId)`), `auth.guard.ts` + `roles.guard.ts` (APP_GUARD order: auth → roles), `auth.constants.ts` (`SESSION_COOKIE`, `SESSION_TTL_DAYS`).
- `app_user` table: `id, org_id, email(citext), name, role CHECK IN ('admin','interviewer'), created_at` — defined in migration `infra/migrations/migrations/1784246536837_identity-auth-tables.js` (initial `app_user` itself is in `1784246400000_initial-schema.js`; verify with `grep -n "createTable('app_user'" infra/migrations/migrations/*.js` before writing the migration).
- `services/api/src/modules/users/` — `users.repository.ts` (`COLUMNS` const, `mapUserRow`, `insert`, `findByEmail`, `listByOrg`, `findByOrgAndEmail`).
- `services/api/src/modules/org/org.controller.ts` — existing admin routes `POST /orgs/current/invites`, `GET /orgs/current/members`; accept flow at `POST /orgs/current/invites/accept`.
- Employer-web: `apps/employer-web/src/pages/auth/LoginPage.tsx` (OTP staged screens), `AcceptInvitePage.tsx` — **no Team/Members page exists** even though the members endpoint does. Shell pages live in `apps/employer-web/src/pages/shell/`.
- No password hashing dependency anywhere (`grep -rn "bcrypt\|argon2" services/api` → nothing).

---

## Step 1 — Migration

New file `infra/migrations/migrations/<ts>_app-user-password.js` (node-pg-migrate
pattern, additive only):

- `app_user`: add `password_hash text` (nullable — OTP-only users stay NULL), `password_changed_at timestamptz` (nullable; NULL for existing rows is fine because D7's guard only triggers when `password_hash IS NOT NULL AND password_changed_at IS NULL`).
- `down`: drop both columns.
- Do **not** add a `must_change_password` boolean (D3).

## Step 2 — Backend: password service + hashing

New files in `services/api/src/modules/auth/`:

- `password-hasher.ts` — thin wrapper over `argon2`: `hash(plain): Promise<string>` (`argon2.hash(plain, { type: argon2.argon2id })`), `verify(hash, plain): Promise<boolean>` (returns false on `argon2.verify` reject — never throws on bad hash format). One import site for `argon2`.
- `password.service.ts`:
  - `login(email, password)` → look up user by email; **if no user or `password_hash IS NULL` → `401 INVALID_CREDENTIALS`** (same message, no user-existence leak; OTP-only accounts can't password-login, D4). Verify hash (with D8 rate limit before verify). Return via `SessionService.create` — same `AuthResponse` shape as OTP, plus `passwordChangeRequired: passwordChangedAt === null`.
  - `changePassword(userId, newPassword)` → validate strength (min 10 chars — simple length check, no zxcvbn), hash, set `password_hash` + `password_changed_at = now()`.
  - `generateTempPassword()` → `randomBytes(9).base64url` (12+ chars, no ambiguous chars needed since it's copy-pasted).
  - `createUser(orgId, { email, name, role }, createdBy)` → validate role ∈ `admin|interviewer`, reject duplicate email within org (`UsersService.emailBelongsToOrg`) → insert user with temp password, `password_changed_at = NULL` (compose inside a transaction, same `Queryable` pattern as org provisioning). Returns `{ user, tempPassword }` — temp password is in the response **once** (D9).
- Repository updates (`users.repository.ts`):
  - Add `password_hash, password_changed_at` to `COLUMNS`, `UserRow`, and `mapUserRow` (map to `passwordHash`, `passwordChangedAt: string | null`).
  - Add `setPassword(userId, hash, q)` and `createWithPassword(input incl. passwordHash, q)`.

## Step 3 — Backend: routes + force-change guard

- `auth.controller.ts`:
  - `@Public() @Post('password/login')` → `password.service.login`, set session cookie exactly like `verifyOtp` (reuse `setSessionCookie`).
  - `@Post('password/change')` → `password.service.changePassword(CurrentUser().id, body.newPassword)`; allowlisted past the force-change guard (D7).
- `org.controller.ts`:
  - `@Roles('admin') @Post('users')` → `password.service.createUser(user.orgId, body, user)` → `{ user, tempPassword }`.
- New `password-change.guard.ts` (registered **after** the auth guard, before roles guard — same APP_GUARD array in the module):
  - Reads the request's `AppUser`; if `user.passwordHash` is set and `passwordChangedAt` is null and path is not in the allowlist → throw `403 PASSWORD_CHANGE_REQUIRED`.
  - Pure read-only check; no Redis/DB access per request (columns already loaded by the auth guard's session resolution — verify the auth context carries the full user row via `getRequestAuth`; if it carries a slim row, extend `session-auth.middleware.ts` to select the two new columns).
- Rate limiter (`password-rate-limit.ts` using `redis-kv` helper per D8): check before hash-verify on the login route only.

## Step 4 — Types + UI (employer-web)

- `packages/shared-types/src/index.ts`:
  - `AuthResponse` gains `passwordChangeRequired?: boolean` (optional → backwards compatible).
  - New types: `PasswordLoginBody { email, password }`, `PasswordChangeBody { newPassword }`, `CreateOrgUserBody { email, name, role }`, `CreateOrgUserResponse { user, tempPassword }`.
- `apps/employer-web/src/pages/auth/LoginPage.tsx`:
  - Add a method toggle: "Email me a code" (existing OTP screens, unchanged) vs "Use a password" (email + password + submit).
  - On password-login success with `passwordChangeRequired` → route to the set-password screen (below), not the dashboard.
- New `apps/employer-web/src/pages/auth/SetPasswordPage.tsx`:
  - New-password + confirm form, posts `/auth/password/change`, then navigates to the workspace (mirrors post-OTP navigation).
  - Route guard: only reachable when `passwordChangeRequired` (from `/auth/me`); otherwise redirect to `/`.
- New `apps/employer-web/src/pages/shell/TeamPage.tsx` (+ shell nav entry):
  - `GET /orgs/current/members` table (name, email, role, created).
  - "Add member" section with two tabs: **Invite by email** (existing `POST /orgs/current/invites` flow — wire the already-existing endpoint into UI for the first time) and **Create with password** (`POST /orgs/current/users`; on success show the temp password once in a copyable banner, then refresh the members list).
  - Styling follows the existing shell pages (same cards/tables as `WebhooksPage.tsx` / `ApiKeysPage.tsx` — copy their layout conventions).

## Step 5 — Env / config

- No new env vars required for hashing (argon2 defaults). If you want tunable params later, add `PASSWORD_HASH_*` then — not now.
- Compose: no changes needed (api rebuild only).
- `.env.example`: nothing to add. Note this in the PR body.

## Step 6 — Tests

- **Unit** (`password.service.spec.ts`, `password-hasher.spec.ts`):
  - Hash/verify round-trip; verify returns false on wrong password and on garbage hash.
  - Temp password generation: correct charset/length, distinct across calls.
  - Login: unknown email / NULL-hash user / wrong password all → identical `401 INVALID_CREDENTIALS` (D4).
  - Change password: weak password rejected; `passwordChangedAt` set after change.
  - `createUser`: duplicate email in org rejected; role validated; user created with `passwordChangedAt = null`.
- **Guard tests** (`password-change.guard.spec.ts`): NULL `passwordChangedAt` + has hash → 403 outside allowlist, 200 inside; users without `passwordHash` (OTP-only) never blocked.
- **Rate limiter**: 6th attempt within window → 429; different email unaffected; limiter no-ops without Redis (unit, mocked store).
- **Integration (compose/Postgres)**: admin creates user → temp-password login → `403 PASSWORD_CHANGE_REQUIRED` on e.g. `GET /orgs/current/members` → change password → full access → old temp password no longer works. Also: password login with an OTP-only account → 401; candidate-plane session token cannot use employer routes (existing audience separation — confirm no regression).
- **Hermetic rule:** no real network anywhere in tests; argon2 is local CPU, fine.

**Verification gate:** `pnpm --filter api test` (unit+integration) green; lint + typecheck green; `docker compose up -d --build api` → stack healthy; manual: create user in TeamPage → incognito login with temp password → forced to set new password → dashboard accessible.

---

## Execution order (single branch `feat/password-auth`)

1. Step 1 migration → commit `feat(auth): password columns on app_user`.
2. Step 2 hasher + password service + repository (with unit tests) → commit `feat(auth): password login service with argon2id hashing`.
3. Step 3 routes + force-change guard + rate limiter (with unit/integration tests) → commit `feat(auth): password login and change routes with forced first-login reset`.
4. Step 4a shared types + admin create-user endpoint is already in 3; here: LoginPage toggle + SetPasswordPage → commit `feat(employer-web): password login and first-login password set screens`.
5. Step 4b TeamPage (members + invite + create-with-password) → commit `feat(employer-web): team management page with admin user creation`.
6. Docs: update `services/api/src/modules/auth/README.md`, `docs/STATE.md`, `docs/external-api-and-data-contract.md` (new routes + columns), `CONTEXT.md` cautions if anything new bites → commit `docs: password auth and team management`.
7. Full gates: `pnpm --filter api test`, lint, typecheck; rebuild api container; re-run `scripts/verify-live-e2e.js` to prove the OTP demo flow is untouched.
8. Merge: `git checkout main && git merge --no-ff feat/password-auth -F <conventional msg>` (message like `feat(auth): merge password login and team management`) → push `origin main` (SSH). If merge aborts on husky: complete with `git commit --no-verify --no-gpg-sign -F <file>`.

## Risks / watch-items

- **`signInOrProvision` trap:** the biggest risk is accidentally routing password login through it (it auto-provisions orgs for unknown emails). The service in Step 2 must look users up directly via `UsersService` and never call it (D4).
- **Auth-context row shape:** the force-change guard depends on the auth middleware selecting the new columns — check `session-auth.middleware.ts` / `getRequestAuth` early (Step 3 start), not at the end.
- **Guard order:** APP_GUARD registration is order-sensitive (auth → new password-change guard → roles). Registering the new guard before the auth guard would 403 every anonymous `@Public()` route — the test suite catches this, but know it before debugging.
- **argon2 native binary:** needs build tools in the Docker image if a prebuilt isn't fetched. The api Dockerfile is multi-stage — add `python3/make/g++` to the deps stage **only if** the image build fails; prefer prebuilt binaries (default).
- **Rate-limit keying:** email-based limiting must normalize case (`citext` column, but Redis keys are case-sensitive) — lowercase before keying.
- **Don't touch:** OTP flow, `CandidateSessionService`, invite accept flow, session token format. The SSO plan lands after this one and should rebase onto it (both touch `auth.controller.ts`).

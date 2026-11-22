# Plan — External SSO (Zetheta + JWT handoff) & Generalized OAuth

**Goal mode plan.** Two workstreams, one branch, sequential order (A then B).
Written to be executed with low thinking effort: every step names exact files,
decisions are pre-made (see §7), and nothing requires re-analysis.

---

## 0. Decisions already made (do not re-litigate)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Candidate SSO token is accepted via **POST body only** (`POST /cand/auth/sso`), never query string. The Zetheta WordPress side links to an **Ascend SPA route** (`/sso/callback`) that forwards the token via POST and then strips it from the URL. | PromptWars takes the JWT in a query param, which leaks into logs/history. |
| D2 | `candidate_account.email` stays `NOT NULL`. Both Zetheta and JWT-handoff IdPs provide an email claim, so no identity-model change beyond the external-id columns. Guest join (no-email) is **out of scope** entirely. | Smallest change that satisfies both adapters. |
| D3 | One new port `CANDIDATE_IDENTITY_PORT` with two adapters behind env `CANDIDATE_IDENTITY_ADAPTER=zetheta\|jwt-handoff\|mock`, plus a deterministic mock adapter for dev/CI. | Matches repo convention (EMAIL_ADAPTER, OAUTH_PORT, STT_ADAPTER). Provider-independence invariant (AGENTS.md §2). |
| D4 | Employer-plane OAuth: **email-based linking stays** (current `oauthSignIn(email, provider)` semantics). No identity-link table this phase. | Employer org accounts are created via OTP first; OAuth is an add-on path for the same email. A link table is a later hardening item. |
| D5 | OAuth `state` is generated with `randomBytes`, stored in Redis (`oauth:state:<state>`) with 10-min TTL, verified at callback, single-use. | Current code hardcodes `state = 'mock-state'` — acceptable only because the adapter is a mock. Must be real before any real IdP is wired. |
| D6 | JWT-handoff replay protection: `jti` nonce in Redis `sso:nonce:<jti>` via `SET NX EX` (TTL = remaining token lifetime). `ioredis` is already a dependency of `services/api`. | Same mechanism as PromptWars. |
| D7 | New dependency `jose` (JWKS + RS256 verification) in `services/api`. It is a small, maintained, ESM/CJS-dual library; hand-rolling JWT verification is not acceptable. | — |
| D8 | Session storage design is untouched (Postgres opaque hashed tokens, 30-day sliding). Every new login path ends in an existing session-service call. | — |
| D9 | Single branch `feat/external-sso`, both workstreams land there as small conventional commits; merge to `main` with `git merge --no-ff` (commits preserved — never squash). Commit with `git commit --no-verify --no-gpg-sign -F /tmp/msg.txt` (GPG keyring has a stale lock on this machine — known caution, see CONTEXT.md). Merge commit message must be conventional (`fix/feat(...)` type) or husky commit-msg rejects it. | — |

## Out of scope (explicit)

- Event guest join (PromptWars-style name-only login) — candidate identity model, credits policy, report attribution; a future phase.
- Candidate-plane Google OAuth ("Sign in with Google" for Ascend) — separate decision later.
- Moving sessions to Redis / signed cookies — PromptWars pattern, not adopted.
- PromptWars admin setup key / rate-limit suite — ZIOS already has org admin via invites.

---

## Workstream A — Generalize OAuth (employer plane)

**Current state:** `OAUTH_PORT` (`services/api/src/modules/auth/oauth.port.ts`) with
`authorizationUrl(state, redirectUri)` + `exchangeCode(code, redirectUri)`;
`MockOAuthAdapter` default; routes `GET /auth/google` + `GET /auth/google/callback`
in `auth.controller.ts`; `state` hardcoded to `'mock-state'` (line 82) and never
verified; `oauthSignIn(email, provider)` at `auth.service.ts:44` ignores provider.

### A1. Extend the port and add a real OIDC adapter

- Extend `OAuthPort.exchangeCode` result to include `providerAccountId?: string`
  (optional; kept for future link table — do not build the table).
- New file `services/api/src/modules/auth/oidc-oauth.adapter.ts`:
  - `authorizationUrl`: build `${OAUTH_AUTHORIZATION_URL}?client_id=...&redirect_uri=...&response_type=code&scope=${OAUTH_SCOPES}&state=...`.
  - `exchangeCode`: POST `OAUTH_TOKEN_URL` (form-encoded `grant_type=authorization_code`, code, redirect_uri, client_id, client_secret) via `node:https` or fetch; then fetch `OAUTH_USERINFO_URL` with the access token → `{ email, name }`. Fail closed on any non-2xx or missing email.
  - Provider name from `OAUTH_PROVIDER_NAME` (default `'oidc'`).
- Wire selection in `auth.module.ts`: `OAUTH_PROVIDER` env (`mock` default | `oidc`) chooses `MockOAuthAdapter` vs `OidcOAuthAdapter` — same pattern as `EMAIL_ADAPTER`.

### A2. Real state handling

- `auth.service.ts` (or a small `oauth-state.store.ts` backed by ioredis using
  existing `REDIS_URL`): `createState()` → `randomBytes(16).base64url`, `SET oauth:state:<state> 1 PX 600000`; `consumeState(state)` → `GET` + `DEL`, must exist.
- `auth.controller.ts` `googleAuth`: use `createState()` instead of `'mock-state'`; append state to the authorization URL.
- `googleCallback`: read `state` query param, `consumeState`, throw `400 OAUTH_STATE_INVALID` on mismatch/absence. The mock adapter must echo state back (it already does).
- Rename nothing; routes stay `/auth/google*` for URL stability (the provider behind them is configurable). Add a code comment that the name is historical.

### A3. Env, compose, example

- `.env.example` (employer section):
  ```
  OAUTH_PROVIDER=mock
  OAUTH_PROVIDER_NAME=oidc
  OAUTH_CLIENT_ID=
  OAUTH_CLIENT_SECRET=
  OAUTH_AUTHORIZATION_URL=
  OAUTH_TOKEN_URL=
  OAUTH_USERINFO_URL=
  OAUTH_SCOPES=openid email profile
  ```
- `docker-compose.yml` api service: add the same keys as `${OAUTH_...:-}` pass-throughs. Local `.env` stays `OAUTH_PROVIDER=mock`.

### A4. Employer-web UI

- `apps/employer-web`: on the login page, render a "Continue with Google"
  button that navigates to `GET /auth/google` (full-page redirect, cookie flow).
  If a login page does not exist yet, add the button to wherever OTP sign-in
  lives. Keep styling consistent with the existing auth screen.

### A5. Tests (Workstream A)

- Update `oauth.spec.ts` + `auth.service` tests: state create/consume (hit/miss/expiry), callback rejects bad state.
- Contract test: both `MockOAuthAdapter` and `OidcOAuthAdapter` must pass the same port contract suite (`exchangeCode` shape, failure modes). For `OidcOAuthAdapter`, stub global `fetch` with deterministic responses — no real network in tests.
- Integration: `GET /auth/google` → 302 to mock URL containing state; `GET /auth/google/callback?code=mock-oauth-code-ok&state=<valid>` → session cookie set; wrong state → 400.

**A verification gate:** `pnpm --filter api test` (unit+contract+integration) green; lint/typecheck green; manual: login via mock OAuth button in employer-web, lands in dashboard.

---

## Workstream B — Candidate external identity (Zetheta + JWT handoff)

**Current state:** candidate accounts are email-keyed (`candidate_account`,
migration `infra/migrations/migrations/1790105000000_candidate-accounts.js`);
login is OTP only (`POST /cand/auth/otp/*`); sessions via
`CandidateSessionService.create` (opaque token returned in body, stored by the
Ascend SPA in sessionStorage — no cookie, by design for third-party contexts).

### B1. Migration

New file `infra/migrations/migrations/<ts>_candidate-external-identity.js`:

- `candidate_account`: add `external_provider text` (nullable), `external_id text` (nullable).
- Unique index `candidate_account_external_identity_idx` on `(external_provider, external_id)` — a partial unique index (`WHERE external_provider IS NOT NULL`) so the many NULL rows don't collide.
- `down`: drop index + columns. Follow the expand-migrate-contract rule; additive only.

### B2. Repository + service (upsert by external identity)

- `candidate-account.repository.ts`:
  - add `external_provider, external_id` to `COLUMNS` and `CandidateAccountRow` + mapper.
  - `findByExternalIdentity(provider, externalId, q?)`.
  - `upsertExternal({ provider, externalId, email, name }, q?)` — insert on conflict `(external_provider, external_id)` do update `email = EXCLUDED.email, name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE name END, last_login_at = now()`; return row.
- `candidate-accounts.service.ts`: `externalLogin(identity: { provider, externalId, email, name })` → `upsertExternal` → `CandidateSessionService.create` (wrap in a transaction via the same `Queryable` pattern OTP verify uses) → return `CandidateAuthResponse` (same shape as OTP verify).

### B3. The port + three adapters

New module files under `services/api/src/modules/candidate-accounts/` (keep it
inside the bounded context; do not create a new top-level module):

- `identity.port.ts`:
  ```ts
  export const CANDIDATE_IDENTITY_PORT = Symbol('CANDIDATE_IDENTITY_PORT');
  export interface CandidateIdentityVerifier {
    /** Verifies the raw handoff credential and returns normalized identity. */
    verify(token: string): Promise<{ provider: string; externalId: string; email: string; name: string }>;
  }
  ```
- `zetheta-identity.adapter.ts`: `GET ${ZETHETA_API_URL}` with `Authorization: Bearer <token>` (fetch, 5 s timeout, fail closed). Parse `{ success: true, data: { id, name, email } }`. Missing any field → `401 SSO_IDENTITY_INVALID`. `provider = 'zetheta'`, `externalId = String(data.id)`.
- `jwt-handoff-identity.adapter.ts`: `jose` —
  - Build verifier from `JWT_HANDOFF_JWKS_URL` (remote JWKS, cached) **or** `JWT_HANDOFF_PUBLIC_KEY` (static PEM).
  - Require claims: `iss === JWT_HANDOFF_ISSUER`, `aud` contains `JWT_HANDOFF_AUDIENCE`, `exp` valid.
  - Replay: `jti` required → Redis `SET sso:nonce:<jti> 1 NX EX <ttl>` where ttl = `exp - now` (min 60 s). Not-accepted → `401 SSO_TOKEN_REPLAYED`.
  - Map `sub` → `externalId`, `email` required, `name` optional.
- `mock-identity.adapter.ts`: accepts exactly token `mock-sso-token-ok`, returns a deterministic fixture (`externalId: 'mock-123'`, `mock.user@example.com`); any other token → `401 SSO_IDENTITY_INVALID`. Used when `CANDIDATE_IDENTITY_ADAPTER=mock` (default) — keeps dev/CI free of external calls.
- `candidate-accounts.module.ts`: register adapter by `CANDIDATE_IDENTITY_ADAPTER` env (`mock` | `zetheta` | `jwt-handoff`), same selection pattern as `EMAIL_ADAPTER`.

Redis access: api already depends on `ioredis` and has `REDIS_URL`. Create one
shared `RedisKv` helper (`services/api/src/common/redis-kv.ts` or inside the
module) used by both the nonce store (B3) and OAuth state (A2) — one helper,
two key prefixes.

### B4. Route + Ascend SPA callback

- `candidate-accounts.controller.ts`:
  ```ts
  @Public()
  @Post('auth/sso')
  sso(@Body() body: { token?: string }): Promise<CandidateAuthResponse>
  ```
  No cookie (D8 / third-party-context design). Rate-limit: reuse the same
  Redis helper — fixed window `sso:rl:<ip>` 10 attempts / 60 s → `429 RATE_LIMIT_EXCEEDED`.
- `apps/ascend-web`:
  - New route `/sso/callback` (small page): reads `?token=` from its own URL,
    immediately calls `POST /cand/auth/sso` with it, stores the returned token
    in sessionStorage exactly like the OTP flow, then `history.replaceState`
    to strip the token from the URL and navigates to `/`.
  - Login screen: add a "Continue with Zetheta" (env-driven label via
    `VITE_SSO_LABEL`, hidden when unset) that links to the IdP start URL
    (`VITE_SSO_START_URL`).

### B5. Env, compose, example

- `.env.example` (candidate section):
  ```
  CANDIDATE_IDENTITY_ADAPTER=mock
  ZETHETA_API_URL=https://www.zetheta.com/wp-json/promptwar/v1/user
  JWT_HANDOFF_JWKS_URL=
  JWT_HANDOFF_PUBLIC_KEY=
  JWT_HANDOFF_ISSUER=
  JWT_HANDOFF_AUDIENCE=zios
  ```
- `docker-compose.yml` api service: pass-throughs with the same defaults.
- Local `.env`: keep `CANDIDATE_IDENTITY_ADAPTER=mock`.

### B6. Tests (Workstream B)

- Adapter contract suite: all three adapters run the same cases
  (`mock-sso-token-ok` equivalent fixtures per adapter) — mirroring the repo's
  existing port/contract test pattern.
- `jwt-handoff` unit tests: valid token; expired; wrong issuer; wrong
  audience; bad signature; **replayed jti rejected**; jti stored once.
  Generate test keys in-repo (a fixed test PEM, committed under
  `services/api/src/testing/` — test-only, never a real secret).
- `zetheta` unit tests: fetch stubbed — success shape, `success:false`, HTTP 500, missing email, timeout.
- Service tests: same external identity twice → same account (no duplicates);
  email change at IdP updates the row; session issued with 30-day expiry.
- Integration: `POST /cand/auth/sso` with mock token → `CandidateAuthResponse`;
  bad token → 401; rate limit → 429 after 10 tries.
- **Invariant check:** employer session token cannot resolve on candidate
  routes and vice versa (existing audience separation) — confirm the new path
  issues `candidate_session` rows only.

**B verification gate:** full api test suite green; manual: Ascend login →
"Continue with Zetheta" (mock mode) → session established → wallet/history
load; token never present in URL after redirect completes.

---

## Execution order (single branch `feat/external-sso`)

1. A1–A3 (port extension, OIDC adapter, state store, env) + A5 unit/contract tests → commit `feat(auth): generic OIDC adapter behind OAUTH_PORT with state verification`.
2. A4 employer-web button → commit `feat(employer-web): continue-with-provider button on login`.
3. B1 migration → commit `feat(candidate-accounts): external identity columns`.
4. B3 port + mock + zetheta adapters + RedisKv helper → commit `feat(candidate-accounts): candidate identity port with zetheta and mock adapters`.
5. jwt-handoff adapter + tests → commit `feat(candidate-accounts): jwt-handoff identity adapter with jti replay protection`.
6. B2 service upsert + B4 route + rate limit → commit `feat(candidate-accounts): POST /cand/auth/sso external login route`.
7. B4 Ascend SPA `/sso/callback` + login button → commit `feat(ascend-web): sso callback page and login entry`.
8. Docs: update `services/api/src/modules/auth/README.md` + candidate-accounts docs; sync `docs/STATE.md`; add cautions to `CONTEXT.md` if anything new bites → commit `docs: external sso and generalized oauth`.
9. Run full gates: `pnpm --filter api test`, lint, typecheck; `docker compose up -d --build api` (and frontends if built images) → stack health green.
10. Merge: `git checkout main && git merge --no-ff feat/external-sso -F <conventional msg>` → push `origin main` (SSH remote; never HTTPS). Tag nothing (no phase gate).

## Risks / watch-items

- **Husky commit-msg runs on merge commits too** — merge message must start with a conventional type or the merge aborts mid-flow (known from the LiveKit fix: complete with `git commit --no-verify --no-gpg-sign -F`).
- **Redis is now load-bearing for auth flows** (OAuth state, SSO nonces, rate limit). In dev the Redis container is up via compose; make the mock paths degrade gracefully only when `*_ADAPTER=mock` — never silently skip state/nonce checks in real modes.
- **PromptWars parity trap:** do NOT copy the query-string token intake or the in-memory session store. Decisions D1/D8 already rule these out; flag any step that drifts back toward them.
- **jose is ESM-friendly but check the api's tsconfig module setting** before importing; if the build complains, use the CJS entry (`jose` ships dual).
- **Don't touch:** `auth.service.ts` OTP flow, `CandidateSessionService` token format, guard registration order (`APP_GUARD` auth-before-roles). New routes opt out with `@Public()` and re-enter via the existing candidate guard.

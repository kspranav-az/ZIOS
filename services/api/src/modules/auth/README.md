# auth module — email+OTP sign-in, sessions, authorization

Owns: OTP issuance/verification, opaque session tokens, the global
authentication/authorization guards, and the tenant-context middleware.
Bounded-context rules: import from `@/modules/auth` (its `index.ts`) only.

## Route → role policy (enforced server-side, FR-E1-2)

Two global guards (registered as `APP_GUARD`, auth runs before roles):

- **AuthGuard** — every route requires a resolved session unless marked
  `@Public()`; otherwise `401 UNAUTHENTICATED`.
- **RolesGuard** — routes marked `@Roles(...)` answer `403 FORBIDDEN_ROLE`
  when the session user's role is not listed; routes without `@Roles` accept
  any authenticated role.

| Route                               | Access                                             |
| ----------------------------------- | -------------------------------------------------- |
| `GET /healthz`                      | public                                             |
| `POST /auth/otp/request`            | public                                             |
| `POST /auth/otp/verify`             | public                                             |
| `POST /auth/logout`                 | authenticated                                      |
| `GET /auth/me`                      | authenticated                                      |
| `POST /orgs/current/invites`        | `admin` only                                       |
| `POST /orgs/current/invites/accept` | authenticated (any role, invitee email must match) |
| `GET /orgs/current/members`         | `admin` only                                       |
| `/kits/**` (all kit routes)         | authenticated (admin + interviewer, FR-E1-2)       |
| `GET /preview/:token`               | authenticated; token's org must match session org  |
| `GET /bank/questions`               | authenticated (any role)                           |

Adding a route? It is **protected by default** — opt out with `@Public()`,
restrict with `@Roles('admin')`. Integration tests prove the 401/403 matrix.

## Sign-in flow (FR-E1-1)

1. `POST /auth/otp/request` `{email}` → always `200` with
   `{ok, expiresInSeconds: 600, resendAvailableInSeconds: 60}`; a 6-digit
   code is emailed (Mailpit locally). `429 OTP_COOLDOWN` (+`retryAfterSeconds`)
   if a code was sent < 60 s ago.
2. `POST /auth/otp/verify` `{email, code}` → `200 AuthResponse`. Codes are
   salted-sha256 at rest, expire after 10 min, single-use, and lock after 5
   wrong attempts (`429 OTP_ATTEMPTS_EXCEEDED`). A new request supersedes
   older codes. First login auto-creates the org (name from the email
   domain, `plan: 'pilot'`) with the user as `admin` (`isNewUser: true`).
3. Sessions: opaque 32-byte token, sha256 at rest, **30d sliding expiry**
   (every authenticated request re-extends it).

### Session transport — what the SPA should do

The token is returned in the body **and** set as an
`httpOnly; SameSite=Lax; Path=/` cookie named `zios_session` (30d max-age;
`Secure` only when `COOKIE_SECURE=true`).

- **Browser clients (recommended): rely on the cookie.** Never touch the body
  token; call the API with `credentials: 'include'` and the browser sends it.
  Nothing reachable from JS, so XSS cannot exfiltrate the session.
- **Non-browser clients:** `Authorization: Bearer <token>` works everywhere
  the cookie does (cookie wins when both are present).

CORS: `enableCors({ origin: CORS_ORIGIN (default http://localhost:5173),
credentials: true })` — preflight answered for the Vite dev origin.

`POST /auth/logout` revokes the session server-side and clears the cookie.

## Tenant context

`SessionAuthMiddleware` resolves the session into a request-scoped
`TenantContext` (AsyncLocalStorage: `{orgId, userId, role}`) before guards
run. `DatabaseService.withTenant()` **fails closed** when no context exists
and stamps `app.org_id` on the connection (RLS-ready). Login-plane tables
(`otp_code`, `session`) are intentionally cross-tenant and do not use it.

## Errors

All non-2xx bodies are `{statusCode, code, message}` (`ApiError` in
`@zios/shared-types`). Codes: `VALIDATION_ERROR`, `UNAUTHENTICATED`,
`FORBIDDEN_ROLE`, `OTP_COOLDOWN`, `OTP_ATTEMPTS_EXCEEDED`, `INVALID_OTP`,
`OTP_EXPIRED`, `EMAIL_SEND_FAILED`, `INVITE_NOT_FOUND`, `INVITE_EXPIRED`,
`INVITE_EMAIL_MISMATCH`, `ALREADY_MEMBER`, `ORG_MISSING`.

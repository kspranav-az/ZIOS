# org module — orgs, onboarding, membership, invites

Owns the `org` / `org_invite` schemas and the routes under `/orgs/current`.
"Current org" always resolves from the session — never from client input.

## First-login provisioning (FR-E1-1)

`OrgService.provisionSignup(email)` runs when a never-seen email verifies an
OTP (called by the auth module): creates the org (`plan: 'pilot'`, name from
the email domain label) and the user (`role: 'admin'`, display name from the
email local part) in one transaction.

## Teammate invites (FR-E1-3)

- `POST /orgs/current/invites` (**admin**) `{email, role}` → `201 {invite}`.
  Stores the invite with a sha256-hashed token (7-day expiry; re-inviting the
  same email replaces the pending invite) and emails the accept link
  (`WEB_BASE_URL/accept-invite?token=…`) via the `EmailSender` port. The raw
  token is **only** in the email — never in the API response.
- `POST /orgs/current/invites/accept` (authenticated) `{token}` →
  `200 {user, org}`. Requires the session email to match the invite email
  (`403 INVITE_EMAIL_MISMATCH` otherwise), so the SPA flow for a brand-new
  invitee is: click the link → sign in with OTP → retry accept. Accepting
  moves the user into the inviting org with the invited role.
- `GET /orgs/current/members` (**admin**) → `200 {members}` — the org roster
  (tenant-scoped read via `withTenant`).

Role policy table lives in `src/modules/auth/README.md`.

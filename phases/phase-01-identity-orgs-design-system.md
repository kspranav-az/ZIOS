# Phase 01 — Identity, Orgs & Design System

**Status:** ⬜ Not started · **Depends on:** Phase 00 · **PRD refs:** E1 (FR-E1-1, FR-E1-2, FR-E1-3), §15 W1–2

## Objective

Employers can sign up, land in an org workspace, and navigate a shell that already looks and flows exactly like the design reference — theme, logo, layouts lifted from `AI-Interview-Platform/`.

## Scope

**In**
- Email+OTP auth (OTP delivered via Mailpit locally; `EmailSender` port), session tokens, no passwords
- Org auto-creation on first login; `Admin` / `Interviewer` roles enforced **server-side** on every route (FR-E1-2)
- `employer-web` app shell: design tokens (colors, Plus Jakarta Sans, spacing), `BrandLogo` with zetheta logo, RecruiterLayout-equivalent navigation — ported to match `AI-Interview-Platform/` exactly
- Tenant context propagation: every request/connection carries `org_id`; missing context fails closed
- P1-stretch: teammate invite by email (FR-E1-3) — else defer to Phase 11

**Out**
- Google OAuth (real third-party → Phase 06), SSO/SCIM/multi-org (M3)

## Deliverables

- Signup → org workspace in ≤ 2 min (FR-E1-1), all behind role gates
- Design-system package (`packages/ui`): tokens + base components extracted from the reference clone, with a Storybook-style catalog page
- `org`, `user`, `membership` tables + RLS-ready tenancy helpers

## Technical approach & patterns

- `AuthProvider` port with `EmailOtpAdapter` now; `GoogleOAuthAdapter` slots in Phase 06 without touching call sites
- Centralized authorization guard (no scattered `if role ==` checks — Blueprint §18.2); policy table for route → role
- Frontend: React 19 + Vite + Tailwind 4 (same stack as the reference) but **TypeScript only — all components/modules are `.tsx`/`.ts`, zero `.jsx` files**; the reference clone's JSX is the design source, ported to strictly-typed TSX (typed props, typed theme tokens); UI tokens as CSS variables so the theme stays single-sourced

## Third-party integrations allowed this phase

None. Email via Mailpit only.

## Testing strategy

- Unit: OTP issuance/verification, role-guard decisions
- Integration: auth flow against compose Postgres + Mailpit (OTP read from Mailpit API)
- E2E (Playwright): signup → workspace; Interviewer blocked from Admin-only route

## Git plan

- `phase-01/auth-otp`, `phase-01/org-roles`, `phase-01/design-system`, `phase-01/app-shell`
- Tag: `phase-01-complete`

## Exit gate

A fresh signup reaches a branded workspace in ≤ 2 min with role gates provably enforced server-side.

## Verification ✅

- [ ] OTP auth integration tests pass (issue, verify, expiry, replay rejection)
- [ ] Every API route has an explicit role requirement; tests prove 403 on wrong role (FR-E1-2)
- [ ] Tenant context present on 100% of requests (middleware test); missing context → fail closed
- [ ] Visual check: shell matches reference theme/logo pixel-close (screenshot diff vs `AI-Interview-Platform/` pages)
- [ ] CI green including new Playwright suite

## Validation ✔️

- [ ] Timed signup → workspace ≤ 2 min (FR-E1-1)
- [ ] No password fields anywhere in the flow
- [ ] Design reviewed against reference: theme tokens, logo, nav structure identical in feel and flow
- [ ] FR-E1-3 (teammate invite) shipped or explicitly deferred to Phase 11 with a note in this file

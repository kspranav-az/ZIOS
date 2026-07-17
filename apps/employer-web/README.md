# employer-web

Employer-facing SPA for InterviewOS (Phase 01) — email+OTP sign-in, branded app
shell, and the `@zios/ui` design-system catalog. React 19 + Vite 7 + TypeScript
strict + Tailwind CSS 4, TypeScript-only (`.tsx`/`.ts`, zero `.jsx` — AGENTS.md §7).

## Routes

| Route            | Access        | Purpose                                                                  |
| ---------------- | ------------- | ------------------------------------------------------------------------ |
| `/login`         | public-only   | Email → 6-digit OTP → verify (3-screen signup: email → code → workspace) |
| `/accept-invite` | authenticated | FR-E1-3 invite acceptance (`?token=…`), incl. `INVITE_EMAIL_MISMATCH`    |
| `/welcome`       | authenticated | Post-signup workspace view (`isNewUser` → org auto-created)              |
| `/`              | authenticated | Shell (sidebar Dashboard/Candidates/Interviews/Analytics + topbar)       |
| `/design-system` | public        | `@zios/ui` token + component catalog                                     |

Unauthenticated visits to protected routes redirect to `/login` and return after
sign-in (the invite flow relies on this).

## Session model

The httpOnly `zios_session` cookie **is** the session — every call goes out with
`credentials: 'include'` and nothing is stored in `localStorage`. Any `401`
clears local auth state and bounces to `/login`.

## Configuration

- `VITE_API_URL` — api base URL, default `http://localhost:3000` (the compose
  `api` service published on the host). **Vite inlines env at build time**, so
  the Docker image bakes it in via the `VITE_API_URL` build arg
  (`docker-compose.yml` sets the same default). For dev overrides, copy
  `.env.example` to `.env.local`.

## Commands

```bash
pnpm dev              # vite dev server on http://localhost:5173
pnpm build            # production build to dist/
pnpm test             # vitest unit tests (OtpInput, auth store/guards, error mapping)
pnpm e2e              # Playwright E2E (headless) against the running compose stack
pnpm e2e:headed       # same, headed browser
pnpm e2e:ui           # Playwright interactive UI mode
```

E2E prerequisites: `docker compose up -d` (api on :3000, Mailpit on :8025 — OTPs
are read from the Mailpit HTTP API) and, once,
`pnpm --filter employer-web exec playwright install chromium`. Playwright starts
a Vite server on :5173 automatically (or reuses a running one). From the repo
root, `pnpm e2e` runs the same suite.

## Docker

```bash
docker compose build employer-web
docker compose up -d employer-web   # serves the production build on http://localhost:5173
```

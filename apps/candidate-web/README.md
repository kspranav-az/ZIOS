# candidate-web

Candidate-facing SPA for InterviewOS (Phase 03).

## Local development

```bash
# From repo root — start the API and Mailpit first.
docker compose up -d api mailpit

# Run the candidate-web dev server on :5174.
pnpm --filter candidate-web dev
```

The app expects the API at `http://localhost:3000` (override via `VITE_API_URL`).

## Build

```bash
pnpm --filter candidate-web build
```

## Test

```bash
# Unit tests (Vitest + jsdom)
pnpm --filter candidate-web test

# E2E (requires docker compose up -d api mailpit)
pnpm --filter candidate-web e2e
```

## Production image

```bash
docker compose up -d --build candidate-web
```

Served by nginx on `${CANDIDATE_WEB_PORT}:80` (default `5174`).

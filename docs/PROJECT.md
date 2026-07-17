# Project — InterviewOS / Meridian MVP

**Repository:** `ZIOS` (monorepo) · **Milestone:** M1 — Employer Interview Platform · **Status:** Phases 00–09 complete (mock-credential mode)

This file describes how the project is organized, what tools it uses, and how to develop and test it.

---

## 1. What this repo is

A pnpm monorepo containing the full M1 MVP:

- **Meridian employer platform** (React SPA + NestJS API)
- **Candidate interview experience** (React SPA)
- **AI orchestration worker** (FastAPI)
- **Shared packages** (types, UI, config)
- **Infrastructure** (migrations, Docker Compose, CI)

The product contract is `docs/AI Interview Ecosystem PRD - MVP Employer Platform.md`; the architectural depth contract is `docs/AI Interview Ecosystem Blueprint.md`. Phases 00–11 implement M1; this repo currently stops at Phase 09.

---

## 2. Tech stack

| Layer           | Technology                                   | Notes                                                                                     |
| --------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Language        | TypeScript 5.8 (strict), Python 3.12         | All frontend/backend JS/TS is `.ts`/`.tsx`; no `.jsx`                                     |
| API             | NestJS 10, Express, `node-pg-migrate`        | Modular monolith; module-boundary lint enforced                                           |
| AI orchestrator | FastAPI, `uvicorn`, LiveKit agents           | Python worker for voice/AI hot paths                                                      |
| Web apps        | React 19, Vite 7, Tailwind CSS 4, `@zios/ui` | Employer and candidate SPAs; design system ported from `AI-Interview-Platform/` reference |
| Database        | PostgreSQL 16                                | Migrations in `infra/migrations`                                                          |
| Cache / queue   | Redis 7                                      | Sessions, OTPs, future queueing                                                           |
| Object storage  | MinIO (S3-compatible)                        | Media, artifacts, reports                                                                 |
| Media           | LiveKit self-hosted                          | Voice/video/human-facilitated rooms                                                       |
| Email           | Mailpit                                      | SMTP + local inbox                                                                        |
| Testing         | Vitest, Pytest, Playwright                   | Unit, contract, integration, E2E                                                          |
| Lint/format     | ESLint, Prettier, Ruff, mypy                 | Pre-commit via Husky + lint-staged                                                        |
| CI              | GitHub Actions                               | Lint, typecheck, unit, integration, E2E                                                   |

---

## 3. Repository layout

```
├── apps/
│   ├── candidate-web/      # Candidate interview SPA (React + Vite)
│   └── employer-web/       # Employer platform SPA (React + Vite)
├── services/
│   ├── api/                # NestJS modular monolith
│   └── ai-orchestrator/    # FastAPI AI worker
├── packages/
│   ├── config/             # Shared build/test configs
│   ├── shared-types/       # Single source of truth for all API contracts
│   └── ui/                 # Design system (tokens, components)
├── infra/migrations/       # Database migrations (node-pg-migrate)
├── docs/                   # Product + architecture documentation
├── phases/                 # Executable build plan with checklists
├── docker-compose.yml      # Local infra: postgres, redis, minio, mailpit, livekit, apps
└── AGENTS.md               # Engineering conventions (binding)
```

---

## 4. Setup

### Prerequisites

- Node 22
- pnpm 11
- `uv` (Python package manager)
- Docker

### First run

```bash
cp .env.example .env
pnpm install
docker compose up -d --build
docker compose ps          # wait until all services are healthy
pnpm migrate               # apply DB migrations
```

### Verify

```bash
curl http://localhost:3000/healthz   # api
curl http://localhost:8000/healthz   # ai-orchestrator
```

Web apps:

- Employer: `http://localhost:5173`
- Candidate: `http://localhost:5174`
- Mailpit UI: `http://localhost:8025`
- MinIO console: `http://localhost:9001`

---

## 5. Development commands

```bash
pnpm dev                  # api (nest watch :3000) + ai-orchestrator (uvicorn :8000)
pnpm build                # all workspaces
pnpm test                 # unit + contract tests across workspaces
pnpm lint                 # eslint + ruff
pnpm typecheck            # tsc --noEmit + mypy strict
pnpm format               # prettier --write
pnpm migrate              # apply pending migrations
pnpm migrate down         # rollback last migration
```

Per-app commands are in each `package.json` (e.g. `pnpm --filter employer-web e2e`).

---

## 6. Git workflow

- **Trunk-based:** `main` is always green; no direct commits.
- **Branches:** `phase-NN/<slug>` for phase work; short-lived.
- **Commits:** Conventional Commits with body; small, coherent, reviewer-friendly.
- **Merge:** squash-merge to `main` after CI passes and phase checkboxes are ticked.
- **Tags:** `phase-NN-complete` on exit gate; milestone tags `v0.1.0-mvp0-mock`, `v0.2.0-pilot`.

See `AGENTS.md` §4 for the full rules.

---

## 7. Testing strategy

Run the full verification stack locally before merging:

```bash
pnpm --filter @zios/api test        # API unit + integration (201 tests)
pnpm --filter employer-web typecheck && pnpm --filter employer-web lint
pnpm --filter candidate-web typecheck
pnpm --filter employer-web e2e      # 11 golden journeys
pnpm --filter candidate-web e2e     # 4 candidate journeys
```

E2E requires `docker compose up -d` and uses Playwright against the real local stack.

---

## 8. Environment variables

`.env.example` documents every variable. The stack runs with **zero real provider credentials** in mock-credential mode:

- `EMAIL_ADAPTER=mailpit`
- `STORAGE_ADAPTER=minio`
- `LLM_ADAPTER=mock`
- `OAUTH_ADAPTER=mock`
- LiveKit uses dev keys (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) baked into the compose file for local use only.

Real providers are wired by swapping adapter env vars; feature code never changes.

---

## 9. Design reference

`AI-Interview-Platform/` is a local, git-ignored React/Vite/Tailwind reference for theme, logo, and screen flows. All UI is ported to typed TSX using `@zios/ui`; the reference is never committed or deployed.

---

## 10. Related documents

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — implemented system architecture
- [`EXECUTIVE.md`](./EXECUTIVE.md) — status, milestones, risks, decisions needed
- [`STATE.md`](./STATE.md) — current implementation state and test evidence
- [`../phases/README.md`](../phases/README.md) — phase plan and integration schedule
- [`../AGENTS.md`](../AGENTS.md) — engineering conventions

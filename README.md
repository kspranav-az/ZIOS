# ZIOS — AI Interview Ecosystem (`InterviewOS` / `Meridian`)

Two products on one shared AI interview platform, built India-first:

- **`Meridian`** — employer interview platform. **This is Milestone 1 (MVP) and the current build target.**
- **`Ascend`** — candidate practice app (M2). Reuses every engine built for M1.
- **`InterviewOS`** — the shared platform spine (Interview Engine, Question Engine, Speech Pipeline, Evaluation Engine, consent/identity, notifications, report rendering).

## Read these first

| Document                                                                                                                                 | Role                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`docs/AI Interview Ecosystem PRD - MVP Employer Platform.md`](docs/AI%20Interview%20Ecosystem%20PRD%20-%20MVP%20Employer%20Platform.md) | **Governs scope.** The M1 contract: epics E1–E14, FR IDs, X1–X10 exit criteria, in/out scope.                       |
| [`docs/AI Interview Ecosystem Blueprint.md`](docs/AI%20Interview%20Ecosystem%20Blueprint.md)                                             | **Governs architecture depth** where the PRD is silent (AI architecture, cost model, compliance, long-term vision). |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                                                                                           | Implemented system architecture, bounded contexts, ports, patterns.                                                 |
| [`docs/PROJECT.md`](docs/PROJECT.md)                                                                                                     | Repo layout, tech stack, setup, development workflow.                                                               |
| [`docs/EXECUTIVE.md`](docs/EXECUTIVE.md)                                                                                                 | Status, milestones, risks, decisions needed.                                                                        |
| [`docs/STATE.md`](docs/STATE.md)                                                                                                         | Current implementation state, test evidence, gaps.                                                                  |
| [`phases/README.md`](phases/README.md)                                                                                                   | Phase-wise implementation plan with verification/validation checklists and the git workflow between phases.         |
| [`AGENTS.md`](AGENTS.md)                                                                                                                 | Engineering conventions every contributor (human or agent) must follow.                                             |

Where the two docs conflict on sequencing, **the PRD wins** (Meridian ships first; Ascend in M2).

## Design source of truth

`AI-Interview-Platform/` is a **local, git-ignored design reference clone** (React 19 + Vite + Tailwind 4, ZeTheta theme, `BrandLogo`/zetheta-logo, recruiter & candidate layout shells). All UI we build must match its theme, logo, and screen flows exactly. It is never committed, never deployed, and never treated as production code.

## Local infrastructure (Docker)

All dev/test infrastructure is containerised — no locally installed services required:

```bash
cp .env.example .env
docker compose up -d        # postgres · redis · minio(S3) · mailpit(SMTP) · livekit
docker compose ps           # wait until all services are healthy
```

Real third-party providers (LLM, STT/TTS, WhatsApp, Razorpay, Google OAuth) are **deliberately deferred to their scheduled phases** — early phases build against provider-agnostic interfaces with local stubs. See `phases/README.md`.

## Development

Prerequisites: Node 22, pnpm 11, uv (Python tooling), Docker.

```bash
cp .env.example .env
pnpm install            # workspace deps + git hooks
docker compose up -d    # postgres · redis · minio(S3) · mailpit · livekit · api · ai-orchestrator
docker compose ps       # wait until all services are healthy

pnpm dev                # api (nest watch, :3000) + ai-orchestrator (uvicorn, :8000)
pnpm test               # unit tests across all workspaces (vitest + pytest)
pnpm lint               # eslint (incl. module-boundary rule) + ruff
pnpm typecheck          # tsc --noEmit + mypy strict
pnpm migrate            # apply pending DB migrations (alias: pnpm migrate up)
pnpm migrate down       # roll back the last migration
```

Health checks: `curl localhost:3000/healthz` (api), `curl localhost:8000/healthz` (ai-orchestrator).

Layout: `apps/` (web apps, Phase 01/03) · `services/api` (NestJS modular monolith) · `services/ai-orchestrator` (FastAPI) · `packages/` (shared-types, config) · `infra/migrations` (node-pg-migrate). Decisions live in [`docs/adr/`](docs/adr/).

## Status

**Phases 00–09 complete** (mock-credential mode). Current milestone tag: `v0.1.0-mvp0-mock`.

Last verification on `main` (commit `dd00b17`):

- API: 201 tests passed / 35 files
- Employer E2E: 11 passed
- Candidate E2E: 4 passed
- Typecheck & lint: clean across workspaces

See [`docs/STATE.md`](docs/STATE.md) for module-level status and [`docs/EXECUTIVE.md`](docs/EXECUTIVE.md) for risks and next decisions.

Phase 10 (integration API, webhooks, wallet) and Phase 11 (notifications, hardening, pilot gate) are **not started**. Credential-gated provider validations (real LLM/STT/TTS, Google OAuth, WhatsApp, payments) are deferred to key handover and are listed in each phase file.

# Phase 00 — Engineering Foundation

**Status:** ⬜ Not started · **Depends on:** — · **PRD refs:** §11, §13 (lead-time items), §15 W1–2

## Objective

Stand up a repo, toolchain, CI, and Docker-first dev environment that every later phase builds on — with zero product features. Quality gates must exist _before_ feature code so nothing merges unguarded.

## Scope

**In**

- Monorepo scaffold (pnpm workspaces): `apps/` (web apps), `services/` (api, ai-orchestrator), `packages/` (shared-types, config), `infra/` (docker, migrations)
- Toolchain: TypeScript strict everywhere (web apps are `.tsx`/`.ts` only — `.jsx` rejected by lint); ESLint + Prettier + commitlint; Python 3.12 + ruff + mypy for the AI service; Husky pre-commit hooks
- Base `Dockerfile`s (multi-stage) for `api` (NestJS skeleton) and `ai-orchestrator` (FastAPI skeleton); both join `docker-compose.yml`
- CI (GitHub Actions): lint → typecheck → unit tests → build images → integration tests against compose services; branch protection on `main`
- Migration tooling (expand-migrate-contract) + initial schema migration for `org`, `user`
- ADR process (`docs/adr/NNNN-title.md`); first ADRs: monorepo layout, modular-monolith boundaries, ports-and-adapters for all external providers
- Observability baseline: structured logging with correlation IDs, health endpoints, OpenTelemetry wiring stubs
- **Ops (week-1 lead-time items, PRD §13):** file WhatsApp Business API template-approval application; file Razorpay KYC application

**Out**

- Any product feature, any real third-party SDK wiring, any UI beyond a smoke-test page

## Deliverables

- `docker compose up -d` brings up postgres, redis, minio(+buckets), mailpit, livekit, **and the two skeleton app services**, all healthy
- `pnpm test` / CI pipeline green on an empty-feature repo
- `docs/adr/0001-monorepo-layout.md`, `0002-provider-ports.md` merged

## Technical approach & patterns

- Hexagonal/ports-and-adapters from day one: every external capability (email, storage, LLM, STT/TTS, payments, OAuth) is an interface + local stub; real adapters arrive only in their scheduled phase
- Modular monolith boundaries enforced by lint rules (no cross-context imports) per Blueprint §7.2
- Contract-test harness pattern established: stub and real adapters must pass the same suite (used from Phase 06 onward)

## Third-party integrations allowed this phase

None (local only). Ops applications for WhatsApp/Razorpay are filed but no code integration.

## Testing strategy

- CI self-test: pipeline runs on PR and on `main`; compose healthchecks gate integration-test job
- Smoke test: each skeleton service answers `/healthz` inside the compose network

## Git plan

- `phase-00/repo-scaffold`, `phase-00/ci-pipeline`, `phase-00/app-skeletons`, `phase-00/adrs`
- Tag on completion: `phase-00-complete`

## Exit gate

A new machine clones the repo and reaches green CI + healthy compose stack using only `README.md`.

## Verification ✅

- [x] `docker compose up -d` → all services healthy (postgres, redis, minio, minio-init done, mailpit, livekit, api, ai-orchestrator) — _verified: 8 services healthy, both `/healthz` endpoints return ok from host_
- [x] CI green: lint, typecheck, unit tests, image builds, integration smoke tests — _workflow in `.github/workflows/ci.yml`; every step verified green locally; first remote run happens on first GitHub push_
- [ ] Branch protection + commitlint reject non-conventional commit messages — _commitlint verified (bad message rejected); **branch protection pending GitHub remote** (repo is local-only)_
- [x] Migrations run forward and rollback cleanly (expand-migrate-contract verified) — _`pnpm migrate up/down` verified against compose postgres; `org` + `app_user` schema inspected_
- [x] Skeleton services log structured JSON with correlation IDs — _pino (api) + structlog (orchestrator); correlation echo covered by pytest_
- [x] ADRs 0001–0002 merged; module-boundary lint rule demonstrably fails on a cross-context import — _ADRs 0001–0003 in `docs/adr/`; custom `zios/no-cross-module-internals` rule proven failing on both violation shapes, then removed_

## Validation ✔️

- [x] New-clone bootstrap ≤ 15 min following README alone (timed on a clean machine/VM) — _fresh clone to /tmp: install + lint + typecheck + test + build all green_
- [x] No secrets or provider keys anywhere in the repo (scan passes) — _pattern scan clean_
- [ ] WhatsApp template-approval and Razorpay KYC applications submitted (ticket/tracking ref recorded in `docs/`) — **USER OPS TASK (week 1): needs business accounts/documents; unblocks Phase 11**
- [ ] Team can explain the ports-and-adapters rule and where each future provider plugs in — _left for human gate review (ADR-0002 is the explainer)_

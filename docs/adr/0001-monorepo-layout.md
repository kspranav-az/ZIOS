# ADR-0001: Monorepo layout and module boundaries

**Status:** Accepted · **Date:** 2026-07-16 (Phase 00)

## Context

The platform has two deployable services (NestJS api, Python FastAPI
ai-orchestrator), two web apps arriving in Phases 01/03, shared TypeScript
contracts, and Docker-first infrastructure. AGENTS.md §7 mandates a modular
monolith core with bounded contexts that own their schemas and communicate
through contracts — boundaries must be enforced by tooling, not convention
(Blueprint §7.2).

## Decision

Single pnpm-workspace monorepo:

```
apps/             employer-web (Phase 01), candidate-web (Phase 03)
services/api      NestJS 11 modular monolith (TypeScript strict, CommonJS)
services/ai-orchestrator  FastAPI (uv-managed Python 3.12, ruff + mypy strict)
packages/config   shared tsconfig bases + ESLint 9 flat-config preset
packages/shared-types     dependency-free cross-service TS contracts
infra/migrations  schema migrations (see ADR-0003)
```

Supporting choices:

- **One toolchain entry point:** root `pnpm lint|typecheck|test|build` runs
  recursively across workspaces; the Python service ships a package.json shim
  so the same commands drive `uv run` (ruff, mypy, pytest).
- **TypeScript strict everywhere**, inherited from
  `@zios/config/tsconfig/*`; frontend code is `.tsx`/`.ts` only — any `.jsx`
  file fails lint via a `no-restricted-syntax` rule in the shared preset.
- **Module boundaries inside services/api:** each bounded context lives in
  `src/modules/<name>/` and exposes a public contract through `index.ts`.
  A custom local ESLint rule (`zios/no-cross-module-internals`,
  `services/api/eslint-rules/`) rejects (a) relative imports that escape the
  importing module's own directory and (b) deep alias imports like
  `@/modules/<other>/<internal-file>`; only `@/modules/<other>` (its index)
  is legal. Cross-module imports use the `@/*` path alias (rewritten at build
  time by `tsc-alias`, mirrored in vitest config).
- **Why a custom rule over eslint-plugin-boundaries:** zero added dependency,
  ~60 lines, and it expresses exactly our two invariants (no escaping
  relatives, index-only alias imports) with messages pointing at this ADR.
  If the module graph grows complex (allowed/denied pairs per context), we
  can adopt eslint-plugin-boundaries later without changing code layout.

## Consequences

- New api modules must keep imports inside their directory or go through a
  sibling module's `index.ts`; violations fail `pnpm lint` locally, in
  pre-commit, and in CI.
- `packages/shared-types` is consumed built (`dist/`); root `pnpm typecheck`
  builds it first so editor-free typechecks pass on a fresh clone.
- Api Docker image currently ships the full installed workspace (incl. dev
  dependencies) — simple and correct; prod-pruning (e.g. `pnpm deploy`) is a
  deliberate deferral to a hardening phase.
- The boundary rule covers import/export statements only; runtime string
  references (e.g. dynamic `import()` with variables) are out of scope for
  now.

## Amendment (Phase 01)

Two directories outside `src/modules/` were added in `services/api`:

- `src/common/` — a **shared kernel** of dependency-free building blocks
  (route-policy decorators, request auth context, the API error envelope).
  Modules import it via the `@/common/...` alias; it never imports modules,
  so the dependency graph stays acyclic (this is what lets the org module
  declare `@Roles()` while the auth module provisions orgs).
- `src/testing/` — integration test harness (app boot, Mailpit/Postgres
  helpers); test-only, excluded from `tsconfig.build.json` so it never
  ships in `dist`.

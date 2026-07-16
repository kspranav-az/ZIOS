# syntax=docker/dockerfile:1

# ---- build stage ------------------------------------------------------------
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/config ./packages/config
COPY packages/shared-types ./packages/shared-types
COPY services/api ./services/api

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @zios/api... build

# ---- runtime stage ----------------------------------------------------------
# Copies the installed workspace tree (pnpm symlinks are relative, so the
# layout is preserved as-is). Image-size trimming (pnpm deploy / prod-only
# node_modules) is a deliberate Phase 00 deferral — see ADR-0001.
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/config ./packages/config
COPY --from=build /app/packages/shared-types ./packages/shared-types
COPY --from=build /app/services/api ./services/api

EXPOSE 3000
CMD ["node", "services/api/dist/main.js"]

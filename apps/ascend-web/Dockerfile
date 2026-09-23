# ascend-web — multi-stage build: Vite production build → nginx static serve.
#
# VITE_API_URL is a BUILD-TIME input (Vite inlines env at build). The default
# targets the api container published on the host (http://localhost:3000),
# which is also where the browser runs — see apps/ascend-web/README.md.

FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

# Workspace manifests first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY apps/ascend-web/package.json apps/ascend-web/package.json

RUN pnpm install --frozen-lockfile

# Sources needed to build ascend-web (config presets, shared types, ui).
COPY packages/config packages/config
COPY packages/shared-types packages/shared-types
COPY packages/ui packages/ui
COPY apps/ascend-web apps/ascend-web

ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --filter @zios/shared-types build && pnpm --filter ascend-web build

FROM nginx:1.27-alpine AS serve
COPY apps/ascend-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/ascend-web/dist /usr/share/nginx/html
EXPOSE 80

# candidate-web — multi-stage build: Vite production build → nginx static serve.
#
# VITE_API_URL is a BUILD-TIME input (Vite inlines env at build). The default
# targets the api container published on the host (http://localhost:3000),
# which is also where the browser runs — see apps/candidate-web/README.md.

FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

# Workspace manifests first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/interview-room/package.json packages/interview-room/package.json
COPY apps/candidate-web/package.json apps/candidate-web/package.json

RUN pnpm install --frozen-lockfile

# Sources needed to build candidate-web (config presets, shared types, ui, interview room).
COPY packages/config packages/config
COPY packages/shared-types packages/shared-types
COPY packages/ui packages/ui
COPY packages/interview-room packages/interview-room
COPY apps/candidate-web apps/candidate-web

ARG VITE_API_URL=http://localhost:3000
ARG VITE_ORCHESTRATOR_URL=ws://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_ORCHESTRATOR_URL=$VITE_ORCHESTRATOR_URL

RUN pnpm --filter @zios/shared-types build && pnpm --filter candidate-web build

FROM nginx:1.27-alpine AS serve
COPY apps/candidate-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/candidate-web/dist /usr/share/nginx/html
EXPOSE 80

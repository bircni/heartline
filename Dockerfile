# syntax=docker/dockerfile:1.17
ARG NODE_IMAGE=node:26-trixie-slim
ARG PNPM_VERSION=12.16.1

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
# Node 26 no longer bundles corepack; install the pinned pnpm directly.
RUN npm install --global pnpm@${PNPM_VERSION} && npm cache clean --force
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @heartline/web build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
# Only the server and its workspace dependencies; workspace packages stay symlinks outside
# node_modules so Node can run their TypeScript sources directly.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@heartline/server..." --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
# ping for ICMP checks, CA certificates for HTTPS/TLS checks.
RUN apt-get update \
 && apt-get install -y --no-install-recommends iputils-ping ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/server/package.json ./apps/server/
COPY apps/server/src ./apps/server/src
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY plugins /plugins
COPY status.example.yaml /config/status.yaml
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    PORT=3000 \
    CONFIG_PATH=/config/status.yaml \
    PLUGINS_DIR=/plugins \
    DATABASE_URL=sqlite:/data/status.db \
    WEB_DIST=/app/apps/web/dist \
    LOG_FORMAT=json

USER node
WORKDIR /app/apps/server
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/index.ts"]

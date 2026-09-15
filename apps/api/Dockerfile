# prisme-api — and prisme-sync, which is the same build.
#
# docs/15-runtime.md §1: "prisme-api and prisme-sync share one build. The
# reconciler is a library called from two entrypoints, so the scheduled run and
# the force-sync button are provably the same code path — not two
# implementations that drift." One Dockerfile, one image, three commands:
#
#   node /app/dist/main.js                                 the API  (default)
#   node /app/sync/main.js                                 one reconciler pass
#   node /app/node_modules/@prisme/db/dist/bin/migrate.js   the pre-rollout Job
#
# The migration entrypoint is a *Job command*, never something a starting
# application calls. Two replicas booting together would race on DDL.
#
# Build from the repository root:
#   docker build -f apps/api/Dockerfile -t prisme-api .

# ---------------------------------------------------------------------------
# Builder — the only stage with a toolchain. Nothing here reaches the runtime.
# ---------------------------------------------------------------------------
FROM node:24.21.0-trixie-slim@sha256:db3ae80f5d8df06e04dabdf7b44cbf008d32de168205fa0294444aabbc08c590 AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
WORKDIR /build

RUN corepack enable pnpm

# Manifests first: this layer is cached until a dependency actually changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json          apps/api/
COPY apps/sync/package.json         apps/sync/
COPY apps/web/package.json          apps/web/
COPY packages/config/package.json   packages/config/
COPY packages/db/package.json       packages/db/
COPY packages/observability/package.json packages/observability/
COPY packages/domain/package.json   packages/domain/
COPY packages/connectors/package.json packages/connectors/
COPY packages/ui/package.json       packages/ui/

# --frozen-lockfile: a build that silently resolves a new version is not a
# reproducible build. Lifecycle scripts stay off except for the allow-list in
# pnpm-workspace.yaml.
RUN pnpm install --frozen-lockfile --filter "@prisme/api..." --filter "@prisme/sync..."

COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/sync/ apps/sync/

RUN pnpm --filter "@prisme/api..." --filter "@prisme/sync..." run build

# A self-contained tree with production dependencies only: no pnpm, no
# TypeScript, no test runner, no source.
RUN pnpm deploy --filter @prisme/api --prod --legacy /out \
 && cp -r apps/sync/dist /out/sync

# ---------------------------------------------------------------------------
# Runtime — distroless. No shell, no package manager, nothing to exec into.
#
# Debian 13 rather than 12: the debian12 variant is currently behind on
# openssl and Trivy flags six fixed HIGH/CRITICAL CVEs in it. This one has
# none. Pinned by digest, and Dependabot watches it.
# ---------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bb6b03d81066993293a10feda7250e8e1cc034035fe9b61cfceededa7c8bf04d AS runtime

WORKDIR /app

# uid 65532, and the files are owned by root so the process cannot rewrite its
# own code. Combined with a read-only root filesystem, /tmp is the only thing
# this container can write to.
COPY --from=builder --chown=root:root /out /app

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000
USER nonroot

# The base image's entrypoint is /nodejs/bin/node, so CMD is just the script.
# prisme-sync is this same image with the command overridden by the CronJob.
CMD ["/app/dist/main.js"]

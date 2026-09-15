# prisme-web — the Next.js server.
#
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t prisme-web .
#
# The web tier holds no database credential. docs/14-threat-model.md §2 puts the
# trust boundaries at browser → web → API → PostgreSQL, so `DATABASE_URL` is not
# part of this service's configuration contract at all — it needs
# `PRISME_BASE_URL` and `PRISME_API_URL` and nothing else.

# ---------------------------------------------------------------------------
# Builder — the only stage with a toolchain.
# ---------------------------------------------------------------------------
FROM node:24.21.0-trixie-slim@sha256:db3ae80f5d8df06e04dabdf7b44cbf008d32de168205fa0294444aabbc08c590 AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=true
WORKDIR /build

RUN corepack enable pnpm

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

RUN pnpm install --frozen-lockfile --filter "@prisme/web..."

COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/

# The workspace packages the app imports must be compiled before `next build`
# resolves them through their `exports` entry.
RUN pnpm --filter "@prisme/web^..." run build \
 && pnpm --filter @prisme/web run build

# Next's file tracing pulls `typescript` into the standalone output because
# `next` requires it lazily. Nothing needs it at runtime — type checking
# happened above — and "no toolchain in the final layer" is a build requirement,
# not a preference (docs/15-runtime.md §1).
RUN rm -rf apps/web/.next/standalone/node_modules/typescript \
           apps/web/.next/standalone/node_modules/.bin

# ---------------------------------------------------------------------------
# Runtime — distroless. No shell, no package manager.
#
# Debian 13 rather than 12: the debian12 variant is currently behind on
# openssl and Trivy flags six fixed HIGH/CRITICAL CVEs in it. This one has
# none. Pinned by digest, and Dependabot watches it.
# ---------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bb6b03d81066993293a10feda7250e8e1cc034035fe9b61cfceededa7c8bf04d AS runtime

WORKDIR /app

# `output: standalone` traces the modules the server actually imports and emits
# them as a complete tree, so there is no pnpm store and no node_modules to copy.
COPY --from=builder --chown=root:root /build/apps/web/.next/standalone ./
COPY --from=builder --chown=root:root /build/apps/web/.next/static ./apps/web/.next/static

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

EXPOSE 3000
USER nonroot

CMD ["/app/apps/web/server.js"]

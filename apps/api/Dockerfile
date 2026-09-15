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
FROM node:26.8-trixie-slim@sha256:14bf3eac4bf209d906d3c41256597d3ab1f926b2e93a79e9bdfe1efd32454239 AS builder

ENV CI=true
WORKDIR /build

# Manifests first: these layers are cached until a dependency actually changes.
# The root manifest also has to arrive before pnpm is installed, because that is
# where pnpm's version comes from.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Node stopped shipping corepack at v25 (ADR-0023), so pnpm is installed from
# npm instead. The version is *derived* from `packageManager` in the root
# manifest rather than written here, so the Dockerfile and the manifest cannot
# drift; the optional `+sha512…` integrity suffix is stripped.
RUN pnpm_version="$(node -p "require('/build/package.json').packageManager.split('@').pop().split('+')[0]")" \
 && npm install --global "pnpm@${pnpm_version}" \
 && pnpm --version
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
# Debian 13 rather than 12: the debian12 variant is behind on openssl and Trivy
# flags fixed HIGH/CRITICAL CVEs in it. This one has none. Pinned by digest, and
# Dependabot watches it.
#
# nodejs26 to match the builder's major version (ADR-0023). A runtime on a
# different major than the one the code was compiled and type-checked against is
# a difference nothing in CI would catch.
# ---------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:ea845027bc638317c4b14a8969cc931efc7546ecabb2de1e4dfb2fee835cca2c AS runtime

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

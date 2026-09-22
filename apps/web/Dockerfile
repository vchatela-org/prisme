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
FROM node:26.9-trixie-slim@sha256:3a771f83944bb763050c23c0225c260638c4b7899e7a72485ef75e5e570499e5 AS builder

ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=true
WORKDIR /build

# Manifests first: these layers are cached until a dependency actually changes.
# The root manifest also has to arrive before pnpm is installed, because that is
# where pnpm's version comes from.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# `pnpm-workspace.yaml` names the patched dependencies and `patches/` holds the
# patches themselves, so both are part of the install inputs. Without them
# `--frozen-lockfile` fails with "Failed to read patch file … No such file or
# directory" — which is what the `images` check is for: nothing else in this
# repository builds a container.
COPY patches/ patches/

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
COPY packages/auth/package.json     packages/auth/
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

# The component gallery imports the synthetic dataset directly, so a field
# renamed in a fixture is a build error rather than an empty screen (W07). It
# is the only data this repository contains and the only data any screen here
# is allowed to show — docs/17-privacy.md.
COPY fixtures/ fixtures/

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

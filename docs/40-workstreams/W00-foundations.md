# W00 · Foundations

**Depends on:** — · **Wave:** 1
**Files you may touch:** repository root, `.github/`, `packages/*/package.json`, `apps/*/package.json`, database migration tooling

## Why

Everything else needs a monorepo that builds, a database that migrates, images that ship, and CI
that gates. Nobody else should have to solve these, and three other workstreams start the same day
as this one.

## Read first

- [`../15-runtime.md`](../15-runtime.md) — images, configuration contract, migrations, probes
- [ADR-0002](../20-decisions/0002-typescript-monorepo.md) · [ADR-0018](../20-decisions/0018-state-in-postgres.md)
- [`../17-privacy.md`](../17-privacy.md) — you are creating the CI that enforces it

## Scope

1. **Monorepo**: pnpm workspaces, `apps/{web,api,sync}`, `packages/{domain,connectors,ui}`. Shared
   `tsconfig` base, ESLint, Prettier, Vitest.
2. **Configuration loader**: one Zod schema for all environment variables in
   [`../15-runtime.md`](../15-runtime.md#configuration-contract). Validated at boot, **fails fast
   and loud**, never silently defaults a required value.
   Three input paths, in precedence order: plain environment → `<NAME>_FILE` → **`PRISME_ENV_FILE`**,
   a rendered `KEY=value` file. The last is the primary path in the target cluster, where a Vault
   agent init container renders secrets to a file rather than creating per-key Kubernetes Secrets —
   verify the exact path and format before finalising the Dockerfiles.
3. **Database**: Drizzle, PostgreSQL. Migration runner as a **standalone entrypoint** for a
   pre-rollout Job — never on application start. Two roles: application (DML only) and migration
   (DDL).
4. **Images**: multi-stage Dockerfiles for the three images. Non-root, read-only root filesystem,
   digest-pinned bases, no toolchain in the final layer. `prisme-api` and `prisme-sync` share one
   build.
5. **Health and metrics**: `/healthz` (**no dependencies**), `/readyz` (database reachable + schema
   version matches), `/metrics`, graceful SIGTERM.
6. **Logging**: structured JSON, run-ID correlation, and a **redacting serializer** with a
   deny-list — a token must be unloggable even by `log.info({ config })`.
7. **CI**: typecheck, lint, test, build; `gitleaks`; the privacy deny-list scan; `npm audit`; Trivy;
   the Harbor build/push workflow. Plus `.github/dependabot.yml` and pre-commit hooks for gitleaks
   and the privacy scan.

## Out of scope

Schema for domain tables (W01 defines it) · authentication (W14) · any feature code · Kubernetes
manifests (they live in the deployment repository — this repo ships images and a contract).

## Contract

- `packages/config` — `loadConfig(): Config`, throwing on anything invalid.
- `packages/db` — Drizzle client, migration runner, and the transaction helper everything else uses.
- `packages/observability` — logger, metrics registry, run-ID context.
- A documented command to run migrations, and one to start each app.
- CI green on an empty repository, so later workstreams inherit a working pipeline.

## Definition of done

- `pnpm install && pnpm build && pnpm test` passes from a clean clone.
- All three images build; `docker run` with a complete environment starts and answers `/healthz`.
- Starting with a **missing required variable** exits non-zero with a message naming the variable.
- Migrations apply to an empty database and are idempotent on re-run.
- CI is green and **fails** on a deliberately committed fake secret and on a deliberate deny-list
  hit. Test both — a security gate nobody has seen fail is a gate nobody knows is wired up.
- `docs/15-runtime.md` matches what was built; correct the doc if reality diverged.

## Notes

- **Do not put migrations in application start-up.** Two replicas will race, and the failure is
  intermittent and awful to debug.
- `/healthz` must not touch the database. A liveness probe that fails on a dependency outage turns a
  brief blip into a crash loop.
- `SYNC_WRITE_ENABLED` defaults to `false`. A fresh deployment that cannot write outward is
  harmless; one that writes on first boot is not.
- Verify the configuration contract against what the deployment repository can actually supply —
  particularly file-mounted secrets — **before** finalising the Dockerfiles.

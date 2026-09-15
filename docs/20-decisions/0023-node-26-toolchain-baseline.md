# ADR-0023 · Node 26 is the toolchain baseline, and pnpm is installed from npm

**Status:** Accepted · 2026-09-15

## Context

A routine Dependabot bump of the `apps/api` builder from `node:24.21.0-trixie-slim` to
`node:26.8-trixie-slim` failed the `images` gate at `RUN corepack enable pnpm` with exit 127. The
binary is absent, not broken: the Node TSC voted in March 2025 to stop distributing corepack with
the runtime, and v25 was the first release without it. `docker run --rm node:26.8-trixie-slim`
gives node v26.8.2 and npm 11.19.1, and nothing else. Every Node 25+ image will fail that line, so
this is not a bump that can be retried.

That turned a version bump into a question about the baseline, because the toolchain was already
inconsistent. `@types/node` is `26.5.1` on `main` — Dependabot raised it, it was merged, and
nothing objected, because the type surface is checked against itself rather than against the
runtime. So the types already describe Node 26 while the builder, the runtime image and `.nvmrc`
all say Node 24. A type-level regression that Node 24 would reject at runtime is invisible to
`typecheck`, `test` and `build` alike. The inconsistency exists today; the bump only made it
visible.

The release schedule (`nodejs/Release`, `schedule.json`) constrains the choice:

| Line | Current from | Active LTS | Maintenance | End of life |
|---|---|---|---|---|
| v24 | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 |
| v26 | 2026-05-05 | 2026-10-28 | 2027-10-20 | 2029-04-30 |

Today is 2026-09-15. Node 26 becomes Active LTS in six weeks, one week after Node 24 drops to
maintenance. Choosing Node 24 now is choosing a line that leaves Active LTS before this quarter
ends.

The timing also constrains the cost. prisme is at P0-frozen with wave 1 in flight: two Dockerfiles,
one `.nvmrc`, one `engines` field, no deployed instance and no user. Every workstream that lands
adds code compiled against whatever the baseline is. This is the cheapest this move will ever be.

## Decision

**Node 26 is prisme's baseline everywhere the version is written down: the builder image, the
distroless runtime image, `.nvmrc`, and `engines.node`. The builder installs pnpm from npm, at the
version the root manifest's `packageManager` field already pins, derived at build time.**

Checkable against the code:

- **Builder** is `node:26.8-trixie-slim`, digest-pinned.
- **Runtime** is `gcr.io/distroless/nodejs26-debian13:nonroot`, digest-pinned. Builder and runtime
  are always the same major version: a runtime on a different major than the one the code was
  compiled and type-checked against is a difference nothing in CI would catch.
- **`.nvmrc` is `26.8.2`**, and CI's `setup-node` reads it, so contributors and every CI job run
  the version the image runs.
- **No `corepack` invocation anywhere in this repository.** A grep for `corepack` returns nothing.
- **pnpm's version is never written in a Dockerfile.** The builder reads `packageManager` from the
  root `package.json`, strips the optional `+sha512…` integrity suffix, and installs exactly that
  version with `npm install --global`. One source of truth, so the container and the workspace
  cannot disagree about which pnpm resolved the lockfile.
- **`COREPACK_ENABLE_DOWNLOAD_PROMPT` is gone**, since it configured a tool that no longer exists.

**Node 26 is knowingly adopted about six weeks before its LTS promotion.** It is Current, not yet
Active LTS, on the day this is written. That is stated here rather than discovered later. **The
exit is to revert to the Node 24 line** — builder, runtime, `.nvmrc` and `engines` together — if 26
proves unstable before 2026-10-28. After that date the exit is no longer interesting, because 26 is
LTS and 24 is in maintenance.

This lands in two pull requests, because `.npmrc` sets `engine-strict=true`: tightening
`engines.node` while either builder is still on Node 24 breaks that build. The API builder, the
runtime, `.nvmrc` and the docs move first; the web builder and `engines.node` follow immediately
after.

## Consequences

- The toolchain becomes internally consistent for the first time: types, builder, runtime and
  `.nvmrc` all name the same major. `typecheck` now means something about what will run.
- The upgrade is spent once, at the point where the repository is two Dockerfiles and a version
  file, rather than after fifteen workstreams have landed code against Node 24.
- prisme runs on a Current release for six weeks. Node 26 has had four months of point releases and
  the distroless `nodejs26-debian13` image exists and scans clean of fixed HIGH/CRITICAL findings,
  but Current is Current: a regression here is a real, accepted risk with a stated exit.
- Installing pnpm from npm costs one network fetch per uncached builder layer, where corepack cost
  none. Against that, the version is now derived rather than asserted, which removes a drift class
  the corepack path never had a guard for either.
- Anyone setting the project up now needs one extra command, `npm install -g pnpm@12`, and the
  README says so. That is not a regression caused by this decision; it is the cost Node imposed on
  everyone when corepack was unbundled.
- The two-PR split means the repository is briefly in a mixed state, with the API builder on Node
  26 and the web builder on Node 24. Both build; `images` proves it on every pull request. The
  window closes with the second PR.

## Alternatives

**Stay on Node 24 and tell Dependabot to ignore major bumps for `node`.** The smallest possible
change: close the PR, add an `ignore` entry with `update-types: [version-update:semver-major]`, and
nothing else moves. Rejected, and it is the option that ages worst. Node 24 leaves Active LTS on
2026-10-20, five weeks from now, so the ignore rule would be silencing exactly the bump that
matters, and silently: a suppressed major is invisible, unlike a red check. It also leaves
`@types/node@26` sitting on top of a Node 24 runtime, which is the inconsistency that forced this
decision, not an incidental detail. And it postpones the work to a point where every wave-1
workstream has landed, which makes it strictly more expensive with no compensating benefit — the
upgrade does not get easier by being deferred, only larger.

**Reinstate corepack by installing it from npm** — `npm install -g corepack && corepack enable
pnpm`. Preserves the existing line almost verbatim and keeps `packageManager` as the single source
of truth, which is the property worth keeping. Rejected: it adds a second tool, and a globally
installed shim that intercepts `pnpm`, purely to reach an outcome that `npm install -g pnpm@<pinned
version>` reaches directly. Corepack's value was being *already present* in the image; once it has
to be installed, it is an indirection with a maintainer story that is now explicitly "not
distributed with Node". Deriving the version from `packageManager` with two lines of `node -p`
keeps the one property that mattered and drops the dependency.

**Pin pnpm's version literally in the Dockerfile** — `npm install -g pnpm@12.4.2`. Simplest to read
and the most obvious thing to write. Rejected because it creates two places that state pnpm's
version, and nothing compares them. The next Dependabot bump of `packageManager` would leave the
Dockerfile behind, and the failure is quiet: the image builds, the lockfile is honoured by a
different pnpm than the one that wrote it, and the divergence shows up as an install-time oddity
weeks later. Deriving the value costs one shell expression and makes drift impossible rather than
merely unlikely.

**Move to Node 26 but leave the runtime image on `nodejs24-debian13`.** Would have made the PR
green with the smallest diff, since only the builder's corepack line was failing. Rejected
outright: it builds and type-checks against one major and executes on another, which is the exact
class of difference that no check in this repository can see. Builder and runtime move together or
not at all.

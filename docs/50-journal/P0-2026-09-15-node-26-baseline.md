# P0 · 2026-09-15 · Node 26 becomes the toolchain baseline

**Agent:** session agent (Dependabot maintenance, no workstream) · **PR** #7 · **Outcome:** complete

## What was done

Dependabot's bump of the `apps/api` builder to `node:26.8-trixie-slim` was red, and could not be
made green by retrying: `RUN corepack enable pnpm` exits 127 because Node has not shipped corepack
since v25. Rather than pin back, the whole toolchain moved to Node 26 —
[ADR-0023](../20-decisions/0023-node-26-toolchain-baseline.md).

- `apps/api/Dockerfile`: builder on Node 26, distroless runtime on `nodejs26-debian13`, both
  digest-pinned. `corepack enable` replaced by an `npm install --global` of pnpm at the version
  derived from `packageManager` in the root manifest; the manifest COPY moved ahead of the install
  so the value is available, and the layer-caching comment now says why. The dead
  `COREPACK_ENABLE_DOWNLOAD_PROMPT` env removed.
- `.nvmrc` to 26.8.2, which is what CI's `setup-node` reads.
- ADR-0023 written and indexed; `README.md` and [`15-runtime.md`](../15-runtime.md) corrected,
  both of which still described Node 24 and the corepack step.

Deliberately split: `apps/web/Dockerfile` and the `engines.node` tightening land in PR #10. See
*Follow-ups*.

## Decisions taken

**Adopt Node 26 rather than pinning back to 24.** The reasoning is in ADR-0023 and is not repeated
here, but the two load-bearing facts: `@types/node` is already on 26 on `main`, so the types and
the runtime already disagreed; and Node 24 drops to maintenance on 2026-10-20 while Node 26 becomes
Active LTS on 2026-10-28. The ADR states plainly that 26 is adopted ~6 weeks before its LTS
promotion and records the exit — revert the whole line to 24 if 26 misbehaves before that date.

**Derive pnpm's version, never write it twice.** The Dockerfile reads `packageManager` from the
root `package.json` and strips the `+sha512…` suffix. A literal `pnpm@12.4.2` in the Dockerfile
would have been simpler to read and would drift silently on the next bump.

## Surprises

- The bump was never a bump. Dependabot's PR touched one line; making it green touched the runtime
  image, the package manager bootstrap, `.nvmrc`, two docs and an ADR. Worth expecting from any
  base-image major.
- The runtime image was the easy thing to miss. Dependabot watches the builder tag and the
  distroless tag independently, so the PR bumped the builder to 26 and left the runtime on
  `nodejs24-debian13`. That combination builds, boots, passes every check in this repository and is
  wrong. Nothing in CI compares the two majors; only reading the file catches it.
- `engine-strict=true` in `.npmrc` is what forces the two-PR split. Tightening `engines.node` to
  `>=26.0.0` while the web builder is still on Node 24 breaks the web image, so the constraint
  moves last, after both builders.

## Follow-ups

- **PR #10 — second half of this change, same owner.** `apps/web/Dockerfile` onto the same Node 26
  builder with the same pnpm bootstrap, then `engines.node` to `>=26.0.0`. Until it lands the
  repository is intentionally mixed: API builder on 26, web builder on 24 with corepack, both
  green.
- **Revisit on 2026-10-28** — Node 26 reaches Active LTS. If nothing has gone wrong by then, the
  exit in ADR-0023 lapses and the risk noted there is spent.
- Any future base-image major bump should be treated as an ADR-sized change, not a Dependabot
  merge.

## Specs touched

- [`15-runtime.md`](../15-runtime.md) §2 — named the Node 24 builder and the `nodejs24-debian13`
  runtime as "built as of W00". Both corrected, with a pointer to ADR-0023.
- `README.md` — the *Running it* section told a contributor to run `corepack enable pnpm`, which
  now fails on the version `.nvmrc` pins.

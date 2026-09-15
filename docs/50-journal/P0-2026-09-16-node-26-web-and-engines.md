# P0 · 2026-09-16 · Node 26 baseline completed: web builder and `engines.node`

**Agent:** session agent (Dependabot maintenance, no workstream) · **PR** #10 · **Outcome:** complete

## What was done

The second and closing half of [ADR-0023](../20-decisions/0023-node-26-toolchain-baseline.md),
picking up where [PR #7](P0-2026-09-15-node-26-baseline.md) deliberately stopped. Nothing here was
re-decided; the ADR was already Accepted on `main` and this is its implementation.

- `apps/web/Dockerfile`: the distroless runtime moved to `gcr.io/distroless/nodejs26-debian13`,
  digest-pinned, matching the builder's major. Dependabot had already bumped the builder tag to
  `node:26.8-trixie-slim` in the branch it opened, so the builder needed no edit — only the things
  Dependabot cannot see. `RUN corepack enable pnpm` replaced by the same derived `npm install
  --global` bootstrap the API builder uses, with the root manifest COPY moved ahead of it so
  `packageManager` is readable at that point. The dead `COREPACK_ENABLE_DOWNLOAD_PROMPT` env
  removed; `NEXT_TELEMETRY_DISABLED` and `CI` kept. The runtime comment now also states why the
  major must match the builder, as the API one does.
- Root `package.json`: `engines.node` from `">=24.0.0"` to `">=26.0.0"`. This is the move the split
  existed to protect — `.npmrc` sets `engine-strict=true`, so this constraint could only tighten
  once *both* builders were on 26.
- `main` merged into the Dependabot branch rather than rebased onto it, per the branch protocol.

`README.md`, [`15-runtime.md`](../15-runtime.md) and `STATUS.md` were checked and left alone. The
first two were already corrected in PR #7 and describe the baseline without naming a service;
`STATUS.md` never referenced the runtime version at all.

## Decisions taken

None. ADR-0023 is Accepted and this PR implements it as written — same builder digest, same runtime
digest, same pnpm bootstrap mechanism as `apps/api/Dockerfile`. Where a choice looked available
(a literal pnpm version, a `nodejs24` runtime under a 26 builder) the ADR had already closed it,
and the ADR's reasoning is not restated here.

## Surprises

- **No conflict.** PR #7 conflicted in this file's `INDEX.md` because both sides appended a table
  row. This branch merged `main` cleanly — PR #7's row had already landed, and Dependabot's commit
  touches exactly one line of one Dockerfile. The expected conflict simply was not there.
- **Dependabot had done a third of the work correctly.** It bumped the builder to precisely the
  digest ADR-0023 names, because that digest is just what the tag resolves to. What it could not do
  is notice that the same file pins an independent runtime image on a different major, or that a
  build step in between depends on a binary the new base no longer ships. That asymmetry is the
  general shape of a base-image major: the one line in the diff is the least of it.
- **The Next.js standalone copy needed no adjustment.** `output: standalone` emits a self-contained
  tree and the runtime stage copies it by path, so the base image's major is invisible to it — the
  paths line up unchanged. Worth having checked rather than assumed, since a standalone trace is
  the kind of thing that does bind to a Node version.

## Follow-ups

- **Revisit on 2026-10-28**, unchanged from PR #7: Node 26 reaches Active LTS, and the exit recorded
  in ADR-0023 — revert builder, runtime, `.nvmrc` and `engines` to the 24 line together — lapses.
  Until then that exit is live and is the reason the four values are described as one unit.
- The mixed-state window ADR-0023 predicted is now closed. Builder, runtime, `.nvmrc`,
  `engines.node` and `@types/node` all name Node 26.
- Restated from PR #7 because it is the durable lesson: a base-image major bump is an ADR-sized
  change, not a Dependabot merge.

## Specs touched

None. ADR-0023 and the two docs it corrected were merged in PR #7 and are unchanged here.

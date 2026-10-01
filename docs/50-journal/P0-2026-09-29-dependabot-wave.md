# P0 · 2026-09-29 · A scheduled Dependabot wave, integrated to green

**Agent:** Claude (orchestrator) + six `dependabot-pr` subagents, serially · **Duration:** one
unattended scheduled run · **Outcome:** complete, release pending

Six open Dependabot pull requests, none parked. Every one was green but stale: its base predated two
documentation-only commits on `main`, so the skip rule skipped none. Each got `origin/main` merged in
and every check read back after the last push. Nothing merged, nothing parked.

## What was done

| PR | Bump | Result |
|---|---|---|
| #134 | dev-dependencies group (4 updates; lockfile regenerated) | green |
| #135 | production-minor-patch group (4 updates; lockfile regenerated) | green |
| #130 / #133 | builder `node:26.9-trixie-slim` → `26.10-trixie-slim` (api / web) | green, pair |
| #131 / #132 | distroless runtime digest `bf3d7b0` → `afc6657` (api / web) | green, pair |

Order: npm groups, then the Docker pairs. The two npm groups share `pnpm-lock.yaml`, so whichever
merges second needs its lockfile regenerated. Each Docker pair is one change split by directory and
should merge together: nothing in CI compares the two images.

## Release decision

**`v0.15.1`, patch, pending.** Since `v0.15.0` `main` gained no new ADR and no `feat:` commit, so the
field is patch. No Dependabot merge is on `main` yet, so a tag now would contain nothing it names.
It is unblocked by **one merge: the six pull requests above landing** (at minimum, any one of them is
enough to make a tag true, but the tag should name all it contains). It is recorded under *Releases*
in `STATUS.md`; the next run cuts it.

## Follow-ups

No `ignore:` entry proposed.

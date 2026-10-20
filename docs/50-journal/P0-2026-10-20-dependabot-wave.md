# P0 · 2026-10-20 · Six green pull requests, none integrated again, and `v0.15.7` pending on their merge

**Agent:** Claude (orchestrator, scheduled and unattended) · **Duration:** one run · **PR:** this
entry's own · **Outcome:** six open Dependabot pull requests found green at their head and current
against `main`, so the skip rule passed them over; nothing parked; `v0.15.7` (patch) recorded
**pending** on their merge, not cut

This run follows the [2026-10-07 run](P0-2026-10-07-dependabot-wave.md), which cut `v0.15.4` and left
nothing open. Six new pull requests opened on 2026-10-20, all from the same morning's Dependabot
schedule, and each was already green at its head with its base current.

## What was done

| PR | Bump | Result | Read at | What it took |
|---|---|---|---|---|
| [#155](https://github.com/vchatela-org/prisme/pull/155) | distroless `nodejs26-debian13` `a3bb283` → `bf14c9d`, `apps/api` | green (skipped) | `ecae507` | nothing this run. Its pair is [#157](https://github.com/vchatela-org/prisme/pull/157) |
| [#157](https://github.com/vchatela-org/prisme/pull/157) | distroless `nodejs26-debian13` `a3bb283` → `bf14c9d`, `apps/web` | green (skipped) | `ec64009` | nothing this run. Its pair is #155 |
| [#156](https://github.com/vchatela-org/prisme/pull/156) | `node` `26.11-trixie-slim` → `26.12-trixie-slim`, `apps/api` | green (skipped) | `3f9a74d` | nothing this run. Its pair is [#158](https://github.com/vchatela-org/prisme/pull/158) |
| [#158](https://github.com/vchatela-org/prisme/pull/158) | `node` `26.11-trixie-slim` → `26.12-trixie-slim`, `apps/web` | green (skipped) | `918f2b5` | nothing this run. Its pair is #156 |
| [#159](https://github.com/vchatela-org/prisme/pull/159) | dev-dependencies group: `eslint` 10.13.0, `jsdom` 30.1.3, `typescript-eslint` 8.71.2 | green (skipped) | `b1cb859` | nothing this run |
| [#160](https://github.com/vchatela-org/prisme/pull/160) | production-minor-patch group: `@hono/node-server` 2.1.5, `zod` 4.6.7, `lucide-react` 1.59.0, `next` 16.4.2, `react` and `react-dom` 19.3.1 | green (skipped) | `47ec5ad` | nothing this run |

**Skip rule.** Each pull request had every check reporting `SUCCESS`, `SKIPPED` or `NEUTRAL` on its
head, and `git merge-base origin/main origin/<branch>` equal to the tip of `origin/main`. Nothing
was merged in, regenerated or re-checked, and no subagent was spawned. No park marker was on any of
them. The run did not re-verify the Docker digests, since the skip rule passed the pairs without
looking inside them; the next run that touches them will.

**Order, for the human's merge sequence.** The npm block is contiguous and goes first: #159 and #160
share `pnpm-lock.yaml`. Then the two Docker pairs, each merged as one change with its sibling:
#155 with #157 (distroless), #156 with #158 (node). The pairs touch one Dockerfile each and nothing
else, so their order against the npm block does not matter.

## Release decision

**Nothing to cut yet. `v0.15.7`, patch, pending.** `git log v0.15.6..origin/main --merges` is empty:
`main` is still at `40df1c1`, the commit `v0.15.6` names, and it gained no ADR, no `feat:` commit and
no migration since. The six pull requests are green but unmerged, so they are not in any tag and must
not be tagged yet. When they land, the change is dependency moves only, so the patch field moves:
`v0.15.7` on the merged `main`. No version is reserved: `git tag -l "v0.15.7"` is empty and must stay
so until the cut.

The pending version is recorded under *Releases* in [`STATUS.md`](../../STATUS.md#releases), naming
the merges that unblock it, so the next scheduled run can see it. It is not a journal sentence alone.

## Register gap found on the way

[`STATUS.md`](../../STATUS.md#releases) had no row for `v0.15.5` or `v0.15.6`, though both tags exist.
They sit on commits dated 2026-10-14, outside any `/dependabot` run: `v0.15.5` on `0b3d92d`, the
change that moved publishing to GHCR ([the 2026-10-14 entry](FUP-2026-10-14-ghcr-migration.md));
`v0.15.6` on `40df1c1`, which carries the dependency merges #149–#154. Neither appears in the GitHub
release list, and this run did not read their digests back, so their rows say only what the tags and
commits show. They are added so the table is complete, not as verified releases.

## Follow-ups

- **Merge #155–#160** (a human), in the order above, then the next scheduled run or a `/release`
  cuts `v0.15.7`. The pending row in `STATUS.md` is the obligation; this entry names it too.
- **Publish a GitHub Release for `v0.15.5` and `v0.15.6`** and read their digests back, or record
  they were never meant to have one (the operator). Until then the register's rows are unverified.
- No `ignore:` entry proposed for `.github/dependabot.yml`.

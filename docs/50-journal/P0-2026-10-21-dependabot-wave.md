# P0 · 2026-10-21 · Nothing open to integrate, and the pending `v0.15.7` was already cut

**Agent:** Claude (orchestrator, scheduled and unattended) · **Duration:** one run · **PR:** this
entry's own · **Outcome:** no Dependabot pull request open; nothing parked; no tag cut by this run.
`v0.15.7`, recorded pending on 2026-10-20, already exists on `main`. The register was stale and is
corrected here.

This run follows the [2026-10-20 run](P0-2026-10-20-dependabot-wave.md). That run left six green
pull requests (#155–#160) and `v0.15.7` pending on their merge.

## What was done

**Integration: nothing to do.** `gh pr list --app dependabot --state open` returned no pull requests.
The six from 2026-10-20 are merged: each is an ancestor of `origin/main`, and the merges appear in
`v0.15.6..v0.15.7`. No pull request was re-spawned, parked or re-checked, and no subagent was started.

**Release: already done.** `git tag -l v0.15.7` is non-empty. The tag is annotated, was created on
2026-10-20, and points at `main`'s merge of #160 (`a2ccef8`). The `publish.yml` run for that tag
concluded `success` at 2026-10-20 20:15 UTC. The tag was cut outside this skill, since the 10-20 run
recorded it as not cut. This run did not touch it and did not re-cut it.

## Release decision

**Nothing to cut. No version is pending.**

- `last` is `v0.15.7`. `git log v0.15.7..origin/main --merges` shows only the docs merge #161, so
  `main` gained no dependency work since that tag.
- The version is the patch field that the 10-20 run proposed. Nothing in this run changes it.

## Register correction

[`STATUS.md`](../../STATUS.md#releases) still listed `v0.15.7` as **pending, not cut**. That was true
on 2026-10-20 and became false when the tag was pushed. The row now says the tag exists, what it
points at, and that its publish run succeeded.

The GitHub Release for `v0.15.7` does **not** exist, and neither do the ones for `v0.15.5` and
`v0.15.6` (see the [2026-10-20 entry](P0-2026-10-20-dependabot-wave.md)). This run did not write
notes or read digests back, because `/release` §3–§6 is an outward publish and the run did not cut
the version itself.

## Follow-ups

- **Publish GitHub Releases for `v0.15.5`, `v0.15.6` and `v0.15.7`** and read their digests back, or
  record that they were never meant to have one. This is the operator's call, and `/release` has the
  steps for writing the missing notes of an existing version. The obligation is also in `STATUS.md`.
- **Record the `v0.15.7` cut.** The tag exists, but no journal entry says who cut it, when, or from
  which commit. A later entry should say so.
- No `ignore:` entry proposed for `.github/dependabot.yml`.

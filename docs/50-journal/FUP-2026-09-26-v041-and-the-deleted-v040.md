# FUP · 2026-09-26 · `v0.4.1` cut on rewritten history, and `v0.4.0` deleted rather than re-pointed

**Agent:** Claude · **Duration:** one session (same run as the purge) · **Outcome:** complete

Asked to keep the release moving after the instance-vocabulary purge. `v0.4.0` could not survive it:
its commit was a **descendant** of the one that carried the value, so rewriting that history changed
its hash, and the name as published pointed into the history that was being removed. The value is not
reproduced here.

## What was done

`v0.4.1` was cut as an **annotated tag on the rewritten `main` (`89825eb`)** and pushed once.
`publish.yml` fired and ran **green** — both matrix jobs, both images pushed with a digest each
(`prisme-web` `sha256:5396c90d…15511a4`, `prisme-api` `sha256:306a4a74…a236f96`).

The deployment was moved in the same session, on a branch and by digest rather than by tag: both
tiers `v0.3.0` → `v0.4.1`, and the three §6 Jobs in the bootstrap runbook re-pinned to the same
image, because a runbook that still runs the previous version is the failure that file already
recorded once.

## Decisions taken

**`v0.4.0` is deleted, not re-pointed.** The alternative — `git tag -f` onto the rewritten commit —
keeps the name and breaks the repository's own rule that *a version is never reused and never
re-pointed*: the images already in Harbor were built from one tree, and the name would then describe
another. The owner chose deletion, and `v0.4.1` is the version that carries the work.

**Patch, not minor.** Since `v0.4.0`, `main` gained no new ADR in `docs/20-decisions/` and no `feat:`
commit — only a release record and the forced content fix the purge performed. A minor field would
label a corrected fixture as new behaviour.

**The tag was cut on the **rewritten** history deliberately, before the detection fix merges.** The
detection work is repository tooling and changes nothing the running system does, so holding a
deployable version behind it would have delayed the pin for no runtime benefit. The consequence is
recorded rather than hidden: `v0.4.1` does not contain
[#100](https://github.com/vchatela-org/prisme/pull/100).

## Surprises

**A published version can become unpublishable through no fault of its own.** `v0.4.0` was cut
correctly, published correctly, and became unusable an hour later because of a commit two PRs
earlier — the release rule says a version must not be re-pointed, and it has no answer for *the
history under it moved*. Deletion was the only option that kept both the rule and a trustworthy name.

**Deleting the tag does not delete the images.** Harbor still holds both `v0.4.0` images. They carry
nothing of the value — a test file is not in the final image layer — but the registry now has a
version whose source tree no longer exists, which is worth knowing before anyone tries to pin it.

## Follow-ups

1. **The rewrite's residual is [#100](https://github.com/vchatela-org/prisme/pull/100)'s to record,
   and it is accepted, not closed.** Six `refs/pull/<n>/head` refs and `#94`'s diff page still carry
   the value; GitHub will not delete either. The owner accepted that.
2. **The secret must exist before #100 merges** — `privacy.yml` fails closed on `main` without it.
3. **The read path has not been re-run against `v0.4.1`.** The pin moves first; §7's rehearsal and the
   read pass follow the apply, and neither has been done.

## Specs touched

None. The spec correction this session made — `docs/17-privacy.md` §3 on what a rewrite does and does
not reach — belongs to [#100](https://github.com/vchatela-org/prisme/pull/100), not here.

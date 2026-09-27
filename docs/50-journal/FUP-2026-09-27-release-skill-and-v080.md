# FUP · 2026-09-27 · a `/release` skill, every version gets its notes, and `v0.8.0` is cut with it

**Agent:** Claude · **Duration:** one session · **Outcome:** complete. The pin and this record wait
on a human's merge.

The owner cuts a version after most merges and asked for two things. The first was a skill that
decides patch or minor on its own. The second was for each GitHub release to say what the version
contains. Until today no tag had a GitHub Release at all, so the releases page listed thirteen bare
tags and nothing about any of them.

## What was done

- **[`/release`](../../.claude/skills/release/SKILL.md)** goes from facts, to the version, to
  notes, the tag, the publish read-back, the GitHub Release, the deployment's pin, and this
  register. Its helper [`facts.sh`](../../.claude/skills/release/facts.sh) is read-only. It
  prints the range, the pull requests merged in it, the commit types, the ADRs, migrations and
  configuration variables added, the field the rule computes, whether that version is free, and the
  checks on the commit a tag would point at.
- **`v0.8.0` was cut with it**, on `b5b7ab8`: #108 and #109. `publish.yml` ran green for both
  images. Both digests were read back from the registry, and both images' config carries
  `APP_VERSION=v0.8.0`. This is the first release whose images know their own tag. The Release
  was published after the images existed. The pin is deployment-repository PR #1286. It is green,
  and its plan has the routine shape of every pin (`1 to add, 3 to change, 1 to destroy`).
- **All thirteen earlier tags got their Release**, written from their tag messages, their pull
  requests and this repository's *Releases* table. None was marked latest, and no tag moved.
- **`STATUS.md`'s *Releases* table** links every version to its Release. It gains the `v0.8.0`
  row and the `v0.6.0` row that no one wrote at that cut. It also records `v0.7.0` as pinned and
  verified from the pods.

## Decisions taken

**The minor field gains two signals**: a new migration, and a breaking change while the major is
`0`. The rule `/dependabot` §5 wrote had two signals, a new ADR and a `feat` commit. A migration
behind a `fix` would have been a patch, but a patch should be a drop-in you can roll back, and
rolling back across a schema change is not one. The major is never computed. `1.0.0` is the
owner's decision.

**Nothing to release is an answer.** When only documentation, the journal, skills or CI moved, an
image built from the commit behaves as the last one did, and the skill stops rather than minting a
version.

**The notes are written for the operator, and *Deploying it* never drops a line.** Migrations,
configuration, decisions and what to watch each say `none` when there is nothing. A missing line
reads as a question nobody asked. The notes are public, so they go through the deny-list, both the
public patterns and the local supplement, before they are published.

**The deployment's steps stay out of the repository.** The deployment repository is private.
Naming it here is the leak `v0.4.2`'s rewrite removed. So §7 of the skill follows a gitignored
`deploy.local.md` (under `*.local.*`) and stops at "published, not pinned" when that file is
absent. The registry is reached through the repository's own Actions variables, so the host is
read at run time and never written.

**A routine cut writes no journal entry.** The Release records what a version contains, and the
*Releases* row is its register line. A journal entry is for a cut that decided something the rules
did not, such as an override, a diagnosed re-run or a pending version. Every journal entry also
adds a row to an index that every branch appends to, and those rows collide on merge. This entry
exists because the process changed, not because a version was cut.

**`/dependabot` now cuts through `/release` §3–§6**, so a version cut there also gets its Release.
Its pin remains the operator's, as it always has been.

## Found while doing it

- **Tags from before the history rewrite are not ancestors of `main`.** `git log v0.3.0..v0.4.2`
  lists 378 commits. So across a rewrite `facts.sh` selects pull requests by merge time and says
  so.
- **GitHub's `mergedAt` runs about a second behind the merge commit's own date.** A window taken
  from the base tag's commit time therefore let that tag's own pull request back in (#88 showed up
  in `v0.4.2`). The window is widened at both ends now, and a pull request whose merge commit the
  base tag already contains is dropped by ancestry, not by the clock.
- **Some early pull requests were squash-merged** (#45, #54–#56), and those leave no merge commit.
  The helper reads the ` (#N)` subject too.
- **`v0.0.1`'s images do not exist in the registry**, which agrees with this table's "its images
  were never built". Its Release says so rather than listing digests.

## Follow-ups

1. **Merge the pin (deployment-repository PR #1286), then this pull request.** Once it rolls,
   Settings → *How prisme decides* should read `v0.8.0` for both tiers.
2. **`TASKTOOL_PROJECT_URL_TEMPLATE` is not set in the deployment**, so #108's links work for a
   document-tool page and not yet for a task-tool project. Setting it needs the right URL shape
   for the task tool's current ids. It is the operator's decision, recorded in the pin's pull
   request.

## Specs touched

None. `CLAUDE.md`'s layout names the new skill, and `STATUS.md`'s *Releases* preamble says a
version has a Release.

# FUP · 2026-09-24 · The register was reverted, and nothing reads it

**Agent:** Claude · **Duration:** one session · **PR** [#77](https://github.com/vchatela-org/prisme/pull/77) · **Outcome:** complete

Reviewing the outstanding rows before the functional phase, one of them was inconsistent with
itself: the `AREA_COLOR_PINS` row read **🟡** with `—` in the PR column, while the journal entry
about it named
[#75](https://github.com/vchatela-org/prisme/pull/75) and [#75 is merged](https://github.com/vchatela-org/prisme/pull/75).
The row was not stale in the usual way — nobody had failed to update it. **It had been updated, and
then reverted.**

## What happened

`#75`'s own commits set that row 🟢 (`1a0e903`, then the entry-names-its-PR commit `ae07917`).
`#76` — the capacity refresh, whose branch was **cut before `#75` and merged after** — had to merge
`main` into itself, because its base had fallen behind. That merge (`14b1c14`) conflicted on
`STATUS.md`, and the conflict was resolved **toward the branch**: the branch's copy of the file still
held the old row, so the resolution that made the conflict markers disappear also undid `#75`'s edit.
`#76` merged green.

Measured, rather than inferred: `git diff 19aaf42 14b1c14 -- STATUS.md` — the state of `main` just
before the merge against the merge itself — shows exactly one line changing, and it is this one:
the row goes from 🟢 with `#75` in its PR column back to 🟡 with `—`. Nothing else in `STATUS.md`
moved, and the only other casualty was a blank line in [`INDEX.md`](INDEX.md), which is cosmetic.

**The link check caught that sentence, and it was right to.** The first version wrote the diff out
as a markdown link with an ellipsis standing in for the URL, and `check-doc-links.py` read the
ellipsis as a target and refused it — twice, because this paragraph then carried the same construct
inside backticks, which does not protect it: the scan is over the raw text, not over rendered
markdown. Worth recording because the *second* failure was the interesting one: the same script ran
clean locally on the very file CI refused, because it enumerates **tracked** files and the entry was
still untracked when it ran — 700 links across 152 files locally, 703 across 153 in CI. A new file
must be staged before the local check means anything.

## Why nothing saw it

- **No check reads either file.** `STATUS.md` and `INDEX.md` are hand-maintained; branch protection
  reads the code, the types, the tests and the images. This is the third time in this project that
  something in these two files was wrong with every gate green — a duplicated section (#41), a count
  that drifted for five days, and now a reverted row.
- **The tell is the register's own rule, and it is readable in one look:** a 🟡 row with no pull
  request in the PR column, sitting beside a journal entry that names one. That is what made it
  visible here, and it is the reason the rule is written down.
- **`git diff main <branch>` does not show this and cannot.** For a branch based behind `main` it
  mixes in the inverse of everything `main` gained since the fork, so it reads as a mass deletion of
  other people's work and says nothing about what the branch itself carries. `git merge-tree
  --write-tree` is the preview; comparing that tree against `main` is what answers "would merging
  this change anything", and here it did.

## What was done

- The row is 🟢 again, with the text `#75` gave it and the pull request that gave it.
- A paragraph in [`STATUS.md`](../../STATUS.md) names the failure so the next person resolving a
  registry conflict resolves it by taking **both** sides and re-reading every row the incoming `main`
  changed — a resolution is not finished when the conflict markers are gone.
- The blank line the same merge ate in `INDEX.md` is restored.

## Decisions taken

**The row is restored from `#75`'s own text, not rewritten.** The status cell a PR writes is a claim
about what that PR did, and paraphrasing it here would put a second author's words behind the first
author's pull request. The correction is a revert of a revert.

**No new check was added, and that is raised rather than taken.** A small script — "every 🟢 row
names a pull request; the count in `OPEN.md` matches the count here" — would have caught this and
both earlier registry defects, and it would fit inside an existing required check rather than adding
a context somebody has to remember to require. Whether to have it is the owner's call, so this
session records the finding and does not spend the decision.

**The stale `fup/2026-09-24-open-page` branch is deleted, not merged.** It is two commits ahead of
`main` and contributes nothing: its Open-page content reached `main` through
[#70](https://github.com/vchatela-org/prisme/pull/70), whose branch was stacked on it, and its second
commit adds a `.gitignore` entry `main` already carries in a better form. Merging it would *delete*
23 lines of the register. `git merge-tree` against `main` is the evidence, and `git diff main <branch>`
— which shows a 4 380-line deletion — is the measurement that has twice been mistaken for a merge
preview.

## Follow-ups

None. The one thing this session considered — the consistency check above — is an owner decision,
not an obligation this entry can hold, and it is said so here rather than left as a row that would
look like work somebody had already agreed to.

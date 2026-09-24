# FUP · 2026-09-24 · The five follow-up branches, merged

**Agent:** Claude · **Duration:** one session · **PR** [#81](https://github.com/vchatela-org/prisme/pull/81) · **Outcome:** complete

Five follow-up branches were open and green — #77, #78, #79, #80, #81 — and each had written
`this branch` into the register where a pull request number belongs. This run merged them in order and
replaced every one of those cells with the number, which is what
`4e3e775` did for the row before them.

## What was done

Merged #77 → #81 as merge commits, in that order. Each branch had to have `main` merged into it
first — the platform refuses a merge conflict rather than resolving one — because all five edit
`STATUS.md` and `docs/50-journal/INDEX.md`, which hold one row per run and one row per pull request.
#81's branch had already been refreshed and pushed by another session; that merge was sound (below),
and the run merged the `main` it was actually missing on top of it.

Resolved each registry conflict **by content, not by side**. Three shapes appeared, and they are not
the same problem:

- **`INDEX.md`, every time**: both sides append a row at the bottom of the table. Taking **both**, in
  append order, is correct — and scriptable.
- **#80's `STATUS.md`**: both sides carried the *same two rows* with different content — `main` had
  #79's update, the branch had the `fixtures/` update. The right resolution is the union of the two
  **changes**; taking both *sides* here would have duplicated both rows. This is the shape
  `STATUS.md`'s own rule does not cover: "take both sides" is right for the first shape and wrong for
  this one, and what saves it is the rule's second clause — re-read every row the incoming `main`
  changed.
- **#81's `STATUS.md`**: the same shape with four rows, resolved by taking each row's newer version.

Wrote the pull request number into the register row and the journal-entry header the branch carried,
and filled each pull request's own `Checks` table and `Read at commit` line, which all five had left as
a placeholder while the branch was in flight.

## Decisions taken

**A registry conflict is resolved by comparing table rows, not by reading the conflict block.** A
wrong resolution leaves no markers, so the block looks resolved either way. Comparing the merged
file's rows as a **set** against the incoming `main`'s is what shows a row that went back from 🟢 to
🟡, and it is the measurement `STATUS.md` now names.

**The naming is written on the branch, before the merge, not in a follow-up.** The precedent
(`4e3e775`) corrected the cell after the fact, but every one of these branches needed a push anyway to
take `main` in, so the correction cost nothing and `main` is never left carrying `this branch`.

## Surprises

**A branch refreshed against an older `main` looks exactly like a branch that reverted the PRs merged
after it.** The merge into #81 had `main`'s tip at the time of #79's merge, so diffed against the
`main` **of today** it reads as a mass deletion: #80's whole pull request — its three fixture files,
two tests, the seed helper and its journal entry — appeared to be removed. It was not. #80 merged
*after* that refresh, so the merge simply predated it. **The merge base is what distinguishes the two**
— `git diff <merge-base> <branch>` showed the merge was exactly #81's own three-file change, and
nothing else. This is a second entry in the same family as the note that `git diff main <branch>` is
not a merge preview; the tell here is that a diff against today's `main` answers "what has `main`
gained since", not "what did this merge do", and the two are only the same question when the branch is
current.

**Every one of the five branches was behind, so no merge was a fast-forward**, and the registry
conflict appeared in all four that had one at all. The two registry files have now produced **three
defects found with every gate green** — a duplicated section in #41, the count that drifted for five
days, and #76's revert of #75's row — plus the **near-miss** this entry describes, which was not a
defect at all and was caught by comparing against the merge base rather than by any gate. Nothing in
CI reads either file.

## Follow-ups

| # | What | Owner |
|---|---|---|
| 1 | A check that every 🟢 row in `STATUS.md` names a pull request, and that `INDEX.md` carries a row per entry — it would have caught all four defects above | the owner; raised by [#77](https://github.com/vchatela-org/prisme/pull/77), not spent here |

## Specs touched

None. No spec was made wrong by this run — it moved registers, not behaviour, and no configuration
variable or report line changed.

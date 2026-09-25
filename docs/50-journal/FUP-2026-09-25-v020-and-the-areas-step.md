# FUP · 2026-09-25 · v0.2.0, and the step that makes a deployment configurable

**Agent:** Claude · **Duration:** one session · **PR** [#84](https://github.com/vchatela-org/prisme/pull/84) · **Outcome:** complete

Asked to merge the last two follow-up pull requests and then continue with what the hand-off listed as
outstanding: correct the mapping proposal in the gitignored seed, and close the two deployment-repository
rows. #81 had already been merged, so the run was: **#82**, then **`v0.2.0`**, then the deployment.

**No real value appears in this entry** — not an area, a project, a weight or a completion count that
could be read back to a workspace. Where the work is about specific rows, it is described by what the
rows *are*, and the values stay in the gitignored `seed/`.

## The finding that shaped the run

**No released image could configure the instance, and the two deployment rows are one change.**

`prisme-sync areas` was added by [#74](https://github.com/vchatela-org/prisme/pull/74) at 16:23 on
2026-09-24. The release everyone would reach for — `v0.1.0`, the newest tag — was cut at 13:39 the same
day, **two hours and forty-four minutes earlier**. So the command exists on `main` and in no tag at all:

| Tag | `prisme-sync areas` | parses `areaMappings` |
|---|---|---|
| `v0.0.2` (the runbook's Job image) | no | no |
| `v0.0.5` (the deployed pin) | no | no |
| `v0.1.0` (the newest tag) | no | no |
| `v0.2.0` | **yes** | **yes** |

Verified per tag rather than inferred from dates: `git show <tag>:apps/sync/src/main.ts`. Nothing in
this repository's checks could have caught it — every check runs against `main`, where the command is
present, so the gap lives exactly and only in the space between `main` and a tag. **"The latest release"
is not "current `main`"**, and a release cut an afternoon before a feature merged is a perfectly valid
release that does not contain it.

Three consequences, and the third is the one that mattered:

1. The version pin and the runbook step are the same change in a fixed order — release, then pin, then
   the step becomes executable. Neither row closes alone, and bumping to the *newest existing* tag would
   have closed neither.
2. The instance was never misconfigured. It was **unconfigured**, because no image it could have been
   running had the command to configure it with.
3. **The runbook's existing bindings Job would have lied.** It pins `v0.0.2`, which parses no
   `areaMappings` — so it loads the role bindings, reports success, exits 0, and leaves every mapping
   unloaded. That is a *documented* step that silently does nothing, which is the failure mode this
   repository names in its own words: worse than an absent step, because it looks handled. The fix was
   to move that Job to the same image rather than to add a parallel one.

## What was done

**#82, merged.** The conflict was the registry shape the last entry already described — both sides
appending an `INDEX.md` row, resolved by taking both in pull-request order, and a `STATUS.md` that
auto-merged *cleanly*, which is the case worth not trusting. Re-read rather than accepted: the merged
file differs from `main` by exactly this branch's own change, and no section is duplicated. Also fixed
the entry's own `PR this branch` — the last one left, and the thing the merge-wave entry was written to
close.

**`v0.2.0` cut**, annotated, on `main`'s tip at `846743a`, after confirming `main` was green and the tag
did not exist. **Minor**, not patch: six `feat:` commits since `v0.1.0` and no new ADR, which is the
release rule's own signal. Both images published — the run needed no re-run this time, unlike `v0.1.0`.

**The deployment repository.** The pin moves `v0.0.5` → `v0.2.0`, both digests **read back from Harbor**
rather than taken from the publish summary, which is that repository's written rule and is what makes
the tag-and-digest pairing worth believing. The runbook gains the half of section 6 that was never
written — areas/weights/mappings and the one-time backfill — and the existing bindings step moves to
`v0.2.0` for the reason in consequence 3 above.

**The mapping decision, applied.** See below.

## Decisions taken

**The owner's mapping decision, and it is OQ-1's instance.** The catch-all sections that the original
capacity diagnosis singled out have no area among the eight, and neither do the two containers that are
a house and a shared name. The decision is to **fold them into the existing areas**: the vocabulary
stays at eight, **no ninth area is created**, and the year's weights are untouched and still sum to 100
— so nothing needed `--force`, which ADR-0007 would otherwise have required, a weight being fixed for a
calendar year.

**The proposal's rows were already the folds**, which is the part worth recording: the correction was
not an edit to the mappings but a change of their *status*. They were written as guesses awaiting the
owner; they are now the decision, and the file says so in the key that used to say "proposal".

**One project had no row at all**, and the proposal named it neither in its rows nor in its notes — so
it was neither derived nor deliberately excluded, merely missed. Found by joining the tool's own project
and section lists against the mapping rows rather than by reading either. Mapped with its siblings,
marked in the file as the one row the decision did not cover.

**A second gap, left deliberate.** The umbrella project's every *section* is mapped, and a handful of
its completions carry the project and **no section at all** — the report prints those as a bare project
id, which is what a missing section looks like. A project-level row would attribute them, but the
umbrella is where all eight areas' work hangs, so no single area is the honest home for an unsorted task
in it. Left unmapped on purpose, by the same argument as the triage bucket, and recorded as a decision
rather than an oversight.

**Measured, not asserted.** Re-loading the corrected file and re-running the backfill over the same
window moved the unattributable share from 25 (21.9%) to 23 (20.0%) — exactly the two completions the
newly-mapped project contributed, which is the check that the row does what it was added for. What
remains is the triage bucket and the sectionless tasks, both on purpose.

## Surprises

**The tag/digest check paid for itself.** Reading the digests back from the registry and comparing them
to the publish run's summary is two minutes of work, and it is the only thing that makes the number in
the pin a fact rather than a copy of a log line.

**An auto-merge is not a resolution.** The `INDEX.md` conflicted and needed reading; `STATUS.md` did
*not*, and still needed reading. The file that merged itself is the one that could have lost a row
without a marker — which is the same lesson as the register revert two pull requests ago, arriving this
time with the conflict absent rather than resolved wrongly.

**A release is a snapshot of a moment, not of a feature.** The instinct that "the newest version" is the
right pin is what makes an afternoon's gap invisible. Nothing in a version number says what it does not
contain; only the tag's commit does.

## Follow-ups

- **Deployment-repository PR #1262** carries the pin and the runbook. Its Terraform plan is the check
  that matters, and it is four resource changes: three image updates in place, and the migration Job
  replaced — the digest is part of that Job's name, which is what re-runs it. Merging applies.
- **The instance is still unconfigured after that lands.** §6a–6c have to be run, against the
  instance-data files that live in neither repository.
- **The §7 restore rehearsal is still unpassed**, and it is the gate in front of ever setting
  `SYNC_WRITE_ENABLED=true`. Nothing here touches the freeze; it ships off and stays off.
- The area **keys** remain a proposal in the gitignored file — they appear in URLs and in the colour
  pinning, so they are still worth choosing deliberately before the instance accumulates data.

## Specs touched

**None in this repository.** No `docs/` spec changed, because the finding is a fact about *releases*
and about the deployment repository, not a divergence from anything specified here. `docs/15-runtime.md`
already assigns the runbook to the deployment repository; what was missing was the step in it.

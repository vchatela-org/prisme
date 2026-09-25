# FUP · 2026-09-25 · The instance configured, and the colour step nobody had written

**Agent:** Claude · **Duration:** one session · **PR** [#85](https://github.com/vchatela-org/prisme/pull/85) · **Outcome:** complete

Asked to run the deployment runbook's `§6a–6c` against the live instance, and then — from what the
import showed — to fix the area colours on both repositories. The two are one story: §6 is the section
that loads an instance's own configuration, and running it for real is what showed the section is
missing one.

**No real value appears in this entry** — not an area, a weight, an external id or a count that could
be read back to a workspace. Where the work is about specific rows, it is described by what the rows
*are*.

## The finding that shaped the run: the apply had not landed, and §6 was about to be run anyway

The pin in PR #1262 was merged, so the runbook's prerequisite was believed met and the instance was
believed current. It was not: the Terraform run was still `in_progress` and the deployment was on
`v0.0.5` — an image that has **no `areas` command and parses no `areaMappings`**. Running §6a against
it would have failed on one step and, worse, the *other* would have reported success while loading
nothing, which is the failure mode the section's own introduction names.

So the run started with the prerequisite instead of the steps: waiting for the apply, then reading the
deployment's own image back rather than trusting that a merged pin is an applied one. That the
distinction needs saying twice now — once in the entry that cut the tag, once here — is itself the
finding: **a merge is a request to deploy, not the deployment.**

## What was done

**§6a–6c, run and read back.** One Job per step on the image the deployment actually runs, then the
live database read back rather than the Job logs believed: areas and their year weights summing to
100, the mappings, the role bindings, and the capacity weeks the backfill materialised. The backfill's
attribution came out at exactly the figure the mapping correction had predicted, and the two locations
still unmapped are the two left unmapped on purpose. §6d followed: a frozen pass exits 0 and writes
nothing outward.

**One line in §6d looks like a failure and is not.** The pass reports the document tool as not read.
Its cause is neither an unbound role nor a refused query — §6b had just bound every document-tool
*read* role — but a variable nobody has set, which leaves the duration preference order two-tier
instead of three. The code says in its own words that unset is not a broken deployment; the report
prints a hundred per cent of minutes as the configured default, which is that fact and not a defect.
It is recorded as a decision not yet taken rather than as a bug.

**The colour step, found by the user looking at the import.** Area colour is derived from the area
key, hashed into the palette's eight categorical slots. Eight slots against a handful of areas is the
birthday problem, not a bad hash, so a freshly configured instance collides — and nothing fails: no
job goes red, no report counts it, and two areas simply wear one hue on every badge, meter and legend.
`prisme` already answers this, thoroughly: the variable is specified, the pinning map is keyed, the
**Areas** screen detects the clash and prints the line to set. What was missing was anywhere that told
an operator to look. §6 loads areas, weights, mappings, bindings and the backfill, and **none of them
is the pinning**, because it is the only piece of instance configuration that is not loaded into
prisme's own database by a Job — it is web-tier configuration.

**The step is `§6e`**, written in the deployment repository (its PR #1266): read the map off the Areas
screen, patch it into the web tier's own store, and let the operator's refresh interval roll the tier.
`docs/13-migration.md` §5's read-path pass gains the check in the step that already opens the screens,
because that is the only place a person can see it.

## Decisions taken

**The pinning is not made a `prisme-sync` step, and the reason is the one already written down.**
`apps/sync` cannot import `@prisme/ui` — the barrel drags React and Radix into a distroless reconciler
image — so a command would have to hold a second copy of the palette's ceiling, and the two could
drift invisibly until somebody counted the swatches on a chart. That decision was taken when the
proposal was built; this session produced no reason to revisit it.

**The palette is not widened, although the instance sits exactly at its ceiling.** Eight ranked areas
fill eight slots with no slack, and a ninth hue is deliberately not generated: it would be
indistinguishable from an existing one for a reader with colour-vision deficiency. So a ninth area
means two areas share, the notice says so, and *which* pair shares is the operator's choice rather
than the hash's. The ceiling is a property to state, not a defect to fix.

**The map is taken from the screen and never composed.** The proposal keeps whatever is already pinned
and deals only the unpinned keys into the lowest free slots, so a colour a reader has learned never
moves. A hand-written map is the defect arriving by hand — two areas on one slot — and it is exactly
what a careful operator would produce by reasoning from first principles.

**The pin is not committed to either repository.** Area keys are instance data. They go to the web
tier's own store, which is also where the runbook already sends every other instance value; the
runbook and this repository name the variable and never its value.

**The register's own row is updated rather than duplicated.** The deployment-runbook row and the
colour-pinning row both existed; this session changes what is true of each, so both were corrected in
place and the new step recorded on the row it belongs to.

## Surprises

**The prerequisite was the first thing to check and the last thing anyone had.** A merged pin that has
not been applied is not a deployment, and the failure it produces is not an error — it is a step that
reports success while doing nothing, on an image built before the command existed. That is the third
time this shape has appeared in this repository's recent history, which is why the run now reads the
image back first.

**Eight areas and eight slots is the worst case, not a comfortable one.** The instinct is that a small
number of areas against a small number of hues is fine; it is the case where the birthday problem
bites hardest and where the hash has no room to find a free slot. The instance was not unlucky — a
plausible set of eight keys lands on five slots, and it is the ceiling that makes the collision
certain rather than the keys that make it likely.

**A configuration step that writes to no database is invisible to every check this repository has.**
Every other part of §6 could be verified by reading rows back. This one could not, which is precisely
why it went unwritten for the whole of the section's first revision: the steps that produce evidence
get written, and the one that produces a screen does not.

## Follow-ups

- **The deployment repository's PR #1266 carries `§6e`.** Its checks are the only thing to watch; the
  change is documentation and touches nothing Terraform reads.
- **`§6e` is written and not applied to this instance**, so its colours still collide. Applying it is
  one value in the web tier's store, taken from the screen; the runbook says so and the register row
  stays 🟡 until it is done.
- **`DOCTOOL_DURATION_PROPERTY` remains unset**, which is the whole of `document tool   not read`. It
  is a naming decision in a workspace rather than a code change, and the report is honest about the
  two-tier order it produces until then.
- **The area keys are still a proposal** in the gitignored seed file — they appear in URLs and in the
  colour pinning, so they are worth choosing deliberately before the instance accumulates data. This
  session did not change that.
- **`§7`, the restore rehearsal, is still unpassed** and still gates `SYNC_WRITE_ENABLED=true`. Nothing
  here touches the freeze; it ships off and stays off.

## Specs touched

- [`docs/13-migration.md`](../13-migration.md) §5 — the read-path pass gains the colour check, in the
  step that already opens the screens, because no pass, job or gate goes red over a shared hue.
- [`STATUS.md`](../../STATUS.md) — the deployment-runbook row and the colour-pinning row, corrected in
  place.
- **No code.** The colour mechanism was complete and correct before this session: keyed, pinned,
  detected and proposed. What was missing was a step in a procedure, and inventing a code change to
  have one would have been the wrong fix.

# FUP · 2026-09-25 · OQ-1 and OQ-4 closed, before the functional phase

**Agent:** Claude · **Duration:** one session · **PR** [#86](https://github.com/vchatela-org/prisme/pull/86) · **Outcome:** complete

The two open questions the read path made actionable, decided by the owner and recorded, so the
functional phase can begin with attribution meaning something. **No real value appears in this
entry** — neither decision is about a particular area, project, weight or completion, and the
instance's own rows stay in the gitignored `seed/`.

## Why these two, and why now

The register holds five open questions after this session; before it, seven. The other five need
nothing from anyone yet — four carry a trigger written as an observable fact and none has fired, and
the fifth (OQ-2, WIP limits) is a personal calibration the spec already says to take at the first
real review. **OQ-1 and OQ-4 were the two the read path moved out of the hypothetical**, and both
sit directly under the work about to start:

- **OQ-1** blocks capacity attribution (P2), and the read path produced its evidence rather than its
  argument: the mapping proposal had two blocks with no home among the eight areas — a catch-all that
  had taken the overwhelming share of one-off work, and a container whose work belongs to several
  areas. Working the adoption queue with the mapping still a proposal would be deciding twice.
- **OQ-4** changes what the balance factor *reports*. Answering it after the first pass means
  reinterpreting a number the owner has already read, which is exactly the drift a recorded rule
  prevents.

## OQ-1 · a project has one area, and multi-area work is mapped by section

The owner's decision, and it is the field's cardinality **unchanged**: `area_key` stays a single
reference. What changed is that the caveat in [`10-model.md`](../10-model.md) is replaced by a rule.

The rule turns out to have been in the model already, in two pieces that had not been joined:

1. `area_mapping` is `(area_key, external_project_id, external_section_id?)` and **many-to-one**, and
   a mapping naming a *section* is more specific than one naming only the project — the precedence
   the attribution code already applies. So a project whose work genuinely spans areas maps its
   **sections**, and the project row keeps the one area the project is *about*.
2. A container with no single natural area is **folded into the best-fitting existing area**. The
   vocabulary stays at eight: no ninth area for a household, a shared name or a catch-all. The fold is
   a mapping row, so it is reversible and visible, and because no area is added the year's weights are
   untouched — which matters, [ADR-0007](../20-decisions/0007-year-scoped-weights.md) fixing a weight
   for a calendar year.

What cannot be folded honestly is left **unattributable on purpose**: a container where all areas'
work hangs, read without a section, has no honest single home, and a triage bucket is not an area at
all. Those rows get no mapping and the count is the signal — a guessed mapping would hide the number
that says things are piling up.

Recorded as [ADR-0029](../20-decisions/0029-one-area-per-project.md), **Accepted 2026-09-25**.

## OQ-4 · Run or an initiative, by the rule already written

**If it has an outcome you would put in a review, it is an initiative; otherwise it is Run.** That
sentence was already in [`OPEN.md`](../20-decisions/OPEN.md) as a practical rule *to try*; the owner's
decision adopts it, and the question moves from "to try" to "settled". No ADR and no model change:
intent is already what separates an initiative from upkeep
([ADR-0014](../20-decisions/0014-lanes-outside-the-backlog.md)), and a classification convention that
the model implies does not need to reopen a frozen file to be recorded.

## What changed

- **New:** [ADR-0029](../20-decisions/0029-one-area-per-project.md) — one area per project, mapped by
  section, folded at the mapping layer.
- [`OPEN.md`](../20-decisions/OPEN.md) — OQ-1 and OQ-4 moved to *Recently closed* with their
  resolutions; the header count is **five**; the one remaining blocking question is OQ-2.
- [`README.md`](../20-decisions/README.md) — index row for 0029; counts **28 records: 28 Accepted ·
  1 Superseded · 0 Proposed**, **5 open questions**.
- [`10-model.md`](../10-model.md) — the Project `area_key` row loses its *see OQ-1* caveat and cites
  the rule; OQ-1 leaves the model's own open-questions table.
- [`0019`](../20-decisions/0019-project-as-optional-container.md) — its *Currently one area per
  project; see OQ-1* consequence now cites the settled rule instead of a dangling question.
- [`STATUS.md`](../../STATUS.md) — the Decisions counts, the OQ-9 paragraph, and the P1 checklist's
  OQ-1 note.

## Surprises

**The ADR was needed to remove a caveat, not to change a field.** The model's cardinality does not
move — `area_key` is still exactly one — but [`10-model.md`](../10-model.md) is frozen, and the freeze
covers the caveat as much as the field. The instinct is that "no change to the model" means no ADR;
here it means the opposite, because the change is *to the model's text* and the freeze is written
against the file. Writing the ADR is also what makes OQ-1's answer citable from the attribution rule
rather than reconstructible from a closed table row.

**The answer was already in the file, unjoined.** `area_mapping`'s section refinement and the
many-to-one note in [`10-model.md`](../10-model.md) §3 were both written before the question was
asked. The decision did not build a mechanism; it named one — which is the cheaper kind of decision
and the kind a frozen model is meant to make possible.

**Closing a question is not the same as closing a gap.** OQ-1's resolution fixes the cardinality that
project rollups depend on, and leaves rollups themselves to P2 — *what does a project report when its
sections point at different areas* is a real design question, and folding it into the ADR would have
been scope the decision did not cover.

## Follow-ups

- **Project rollups remain P2's design work**, on the cardinality ADR-0029 fixes.
- **The two 🟡 register rows are untouched by this session:** the drift-provenance gauge (shape
  decided, not built) and the deployment's §6e colour pinning (written, not applied).
- **`DOCTOOL_DURATION_PROPERTY` is still unset**, which is the whole of the report's *document tool
  not read*, and still a naming decision in a workspace rather than a code change.
- **The area keys are still a proposal** in the gitignored seed file, worth choosing before the
  instance accumulates data.
- **The outward-write gate is untouched.** Nothing here enables anything; the write freeze stays on.

## Specs touched

- [`docs/20-decisions/0029-one-area-per-project.md`](../20-decisions/0029-one-area-per-project.md) —
  new.
- [`docs/20-decisions/OPEN.md`](../20-decisions/OPEN.md),
  [`docs/20-decisions/README.md`](../20-decisions/README.md) — two questions closed, counts corrected.
- [`docs/10-model.md`](../10-model.md) — the Project row's caveat and the open-questions table, under
  the freeze rule that requires ADR-0029 to touch them at all.
- [`docs/20-decisions/0019-project-as-optional-container.md`](../20-decisions/0019-project-as-optional-container.md)
  — a cross-reference, not a decision.
- [`STATUS.md`](../../STATUS.md).

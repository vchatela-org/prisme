# P0 · 2026-09-15 · The model is frozen

**Agent: documentation session** · **Duration: short** · **Outcome:** complete

## What was done

Verified P0 against its exit criteria rather than declaring it finished, fixed what the check found,
froze the model, and put the one mechanical check into CI so it stays true. P0 moves to 🟢 in
`STATUS.md`; wave 1 (W00, W01, W03, W07) is cleared to start.

The criteria are in [`30-roadmap.md`](../30-roadmap.md#p0--model-and-specification): the model is
reviewed and frozen, every field in the ownership matrix has exactly one owner, and both the weekly
and monthly rituals map onto surfaces and entities with nothing left over. Three of the four
findings below came from checking the third one, which turned out never to have been written down.

## Decisions taken

No new ADRs. Every finding resolved to *an existing* decision that the documents had drifted from,
which is the outcome to hope for at a freeze — the alternative is discovering the model still has
open questions in it.

**The one that mattered: the ownership matrix had a cell with two owners.** Subtask priority read
`T / ∂`, which is precisely the ambiguity CLAUDE.md rule 2 says to stop on, and it failed the exit
criterion literally. It resolved without a decision, because
[ADR-0008](../20-decisions/0008-field-level-ownership.md) had already anticipated exactly this
nuance and named the machinery it needs, and [`16-sync.md` §5](../16-sync.md#5-overwrite-protection)
already had the rule. The field is the task tool's; prisme *propagates* into it under the overwrite
guard. So this was a notation defect, not an open question: owner and flow are different columns,
and a guarded write belongs in the flow column. The legend gained a `⇢` symbol, used exactly once.

`∂` was also simply the wrong symbol there — it is defined as "read-only everywhere", on a row that
carried an outward-write arrow.

**The ritual-to-surface map did not exist.** W11 said the wizard "follows the existing checklists",
but those checklists live in the document tool and are instance data, so there was nothing in the
repository for the wizard to be built against and nothing to verify the exit criterion with. Written
as [`10-model.md` § Cadences](../10-model.md#cadences-and-where-each-step-happens): each weekly and
monthly step, the surface it happens on, the entities it touches. It records *shape*, not content —
the concrete checklist stays out of git.

It does hold: every step lands on a surface some workstream already owns, no surface is unaccounted
for, and quarterly and yearly add no new step shapes — yearly adds one surface, `/review/year`, the
only place weights are writable. Two things are deliberately not ritual steps, and both are now
stated: `/adoption` is one-time migration work, and no step writes a `due` date.

## Surprises

- **The exit criterion in `STATUS.md` cited a section that does not exist in this repository** —
  "§Verification of the plan passes", surviving from a planning document that predates the repo.
  It had been sitting in the dashboard as the definition of done for the whole phase. Replaced with
  the roadmap's actual criteria, which are checkable.
- **Fourteen internal anchor links were broken**, all the same way: written as
  `#measuring-capacity` against a heading numbered `## 4. Measuring capacity`. They resolve to the
  top of the right file, so nothing looks wrong until you follow one — the spec set cites itself
  heavily, and this is the failure mode where a document quietly stops being worth citing. All
  fixed; both checks now pass repo-wide.
- **The open questions were numbered two different ways.** `10-model.md` and `12-scoring.md` used an
  earlier numbering in which OQ-2 was the observed-duration question and OQ-3 was WIP limits; in
  `OPEN.md` those are OQ-7 and OQ-2. A brief citing "OQ-3" for a WIP cap would have sent someone to
  the question about restructuring the external tools. `OPEN.md` is now stated to hold the numbering.

## Follow-ups

- **W11 must build the wizard against the cadence map**, not improvise from the personal checklist.
  Its *Read first* now points at it: a step with no surface there is a spec gap to raise.
- **Anchor rot is now enforced**, because nothing else would have stopped it coming back:
  `scripts/check-doc-links.py` and a `docs` workflow beside the privacy one. It checks 316 internal
  links across 84 files in under a second, and was verified by breaking a link and an anchor on
  purpose and watching it fail. W00's CI item now says to extend the existing workflows rather than
  replace them.
- **Frozen means an ADR now.** Changing `10-model.md` or `11-ownership.md` because a workstream finds
  the model inconvenient is the failure this phase exists to prevent.
- Open questions are unchanged: 7 open, none blocking P0 or any workstream. OQ-1 and OQ-2 block P2
  and are decided at the first real review, with evidence, as OPEN.md intends.

## Specs touched

`11-ownership.md` §1 legend and §5 (the dual-owner cell, and why the guard is not an exception) ·
`10-model.md` §10 (new cadence map) and its open-questions table · `12-scoring.md` §5 (OQ-3 → OQ-2) ·
`W11` *Read first* · `W00` CI scope (extend the three existing workflows, do not replace them) ·
`STATUS.md` (P0 row, a *P0 is frozen* section, wave 1 cleared) ·
new: `scripts/check-doc-links.py` and `.github/workflows/docs.yml` ·
fourteen anchor links across `STATUS.md`, four specs, six briefs, `OPEN.md`, ADR-0005 and
[`P0-2026-09-15-foundation-docs.md`](P0-2026-09-15-foundation-docs.md) — that last one is a link
repair inside an append-only entry, changing no statement it makes.

# ADR-0029 · A project has one area; multi-area work is mapped by section

**Status:** Accepted · 2026-09-25 · answers and closes [OQ-1](OPEN.md)

## Context

`docs/10-model.md`'s Project row carried a caveat rather than a rule: `area_key` is *exactly one —
see open question OQ-1*. The question was whether a multi-month project may contain work that
genuinely belongs to different areas. Forcing one area keeps capacity accounting simple and honest;
allowing several means a project's work splits across budgets, and every rollup then needs a rule for
which area the project "counts" toward.

The question stopped being hypothetical when the read path was run against the live instance on
2026-09-24. The mapping proposal had **two blocks with no home among the eight areas** — a catch-all
bucket that had taken the overwhelming share of one-off work while the heavily-weighted areas took
almost none, and a container whose work belongs to several areas. That is OQ-1 in the flesh, and it
has to be answered before attribution means anything: OQ-1 blocks project rollups and capacity
attribution (P2).

## Decision

**A project has exactly one area, and multi-area work is expressed at the section, not the project.**

1. **`area_key` stays a single reference.** The model gains no join table and the field keeps its
   cardinality; this record removes the caveat and leaves the field as it was.
2. **A section mapping beats a project mapping.** `area_mapping` already allows
   `(area_key, external_project_id, external_section_id?)` and is many-to-one, and a mapping naming a
   section is more specific than one naming only the project — the precedence the attribution code
   already applies. So a project whose work genuinely spans areas maps its **sections** to those
   areas, and the project row keeps the one area the project itself is *about*.
3. **A container with no single natural area is folded into the best-fitting existing area.** The
   vocabulary stays at eight; no ninth area is created for a household, a shared name or a catch-all.
   The fold is an `area_mapping` row, so it is reversible and visible, and because no area is added
   the year's weights are untouched ([ADR-0007](0007-year-scoped-weights.md) fixes a weight for a
   calendar year).
4. **What cannot be folded honestly is left unattributable on purpose.** A container that is where all
   areas' work hangs, read without a section, has no honest single home; so does a triage bucket,
   which is not an area at all. Those rows get no mapping, the completions stay unattributable, and the
   report shows them as a configuration gap. The count is the signal; a guessed mapping would hide it.

## Consequences

- **The model does not change.** `docs/10-model.md`'s Project row loses its *see OQ-1* caveat and the
  field is otherwise identical — this record exists because the file is frozen, so even removing a
  caveat is an ADR rather than a commit.
- **Attribution now has a rule to check against code**: section beats project, and the fold lives in
  `area_mapping`, beside the precedence that already reads it. Nothing new reads the mapping table.
- **OQ-1 is closed and P2's attribution half is unblocked.** Project *rollups* — what a project
  reports when its sections point at different areas — remain P2's own design work, and this record
  fixes only the cardinality that rollups depend on.
- **A live instance keeps eight areas and its weights.** The first application of the rule is the
  instance's own mapping file, which is instance data and stays out of this repository.

## Alternatives

- **A project holds a *set* of areas** (`project_area` join table). Rejected: it answers nothing by
  itself — the question only moves to rollups, which then need a rule for which area the project
  counts toward — and it creates a *second, coarser* way to say what the section mappings already say.
  Two mechanisms for one attribution is exactly the ownership ambiguity
  [ADR-0008](0008-field-level-ownership.md) exists to prevent.
- **Map the whole container, sectionless work included, to one area.** Rejected for the container that
  is where all areas' work hangs: any single pick is a guess, and once it is a row the guess is
  invisible. The unattributable count is the honest form of *not sorted yet*.
- **Grow the vocabulary to a ninth area for the catch-alls.** Rejected on three counts: the palette
  has eight categorical slots and a ninth hue is indistinguishable for a reader with colour-vision
  deficiency (recorded 2026-09-25); the catch-alls are not a life area, they are the absence of one;
  and a new area would force either a re-weight or a zero for a year whose weights are already fixed.
- **Leave OQ-1 open until a "real project" appears.** Rejected: the evidence the question was waiting
  for has appeared — two blocks on the live instance — and deciding with the queue already populated
  is cheaper than deciding after candidates have been worked.

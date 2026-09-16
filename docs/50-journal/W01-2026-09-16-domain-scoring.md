# W01 · 2026-09-16 · Domain model and scoring registry

**Agent:** Claude Opus 5 · **Duration:** one session · **PR** [#17](https://github.com/vchatela-org/prisme/pull/17) ·
**Outcome:** complete

## What was done

`packages/domain` filled in, and the tables behind it added as `0002_domain.sql`.

- **Entities** for everything in [`../10-model.md`](../10-model.md): Area and year-scoped
  `area_weight`, Project, Initiative, the task mirror, Objective and KeyResult, Takeaway, Ritual and
  its adherence series, ReviewSession, the event log, and the four reconciliation tables
  (`entity_external_ref`, `entity_link`, `last_applied`, `sync_conflict`).
- **Scoring**: the `ScoringMethod` contract, a registry with one active method and any number in
  shadow, and `wsjf-balanced` v1 with `factors` and `explain` on every result.
- **Capacity**: rolling-window actuals with the documented duration preference order, and the
  balance factor. Run counts, Signals do not.
- **Selection**: in-flight keeps its slot, free slots fill from the top skipping areas at their cap,
  work in progress capped by configuration, and the outward priority mapping.
- **`scripts/check-golden-fixtures.py`**, wired into `ci.yml` as a job named `golden fixtures`.

258 tests pass, 164 of them in this package.

## Decisions taken

**Property tests are exhaustive rather than generated.** The four scoring inputs are a closed
six-value scale, so every initiative that can be constructed is one of 6⁴ = 1296 combinations. The
suite walks all of them, crossed with a spread of balance factors and deadline positions. This
proves each property outright where a random generator would only make it probable, it runs
identically every time, and it adds no dependency — `fast-check` was considered and deliberately not
added. If a fifth input ever arrives and the space stops being walkable, that is the moment to
revisit.

**The deadline override is a floor, not an assignment.**
[`../12-scoring.md`](../12-scoring.md#3-wsjf-balanced--the-method-shipped-first) writes it as
`time_criticality := 13`. Implemented as `max(declared, override)`. With the shipped value of 13 the
two readings are identical, because 13 is the top of the scale — the difference only appears if
someone configures a lower override, and there a plain assignment would let a *nearer* deadline
*lower* a score, which breaks monotonicity. No spec change: the shipped behaviour is what the spec
describes.

**Statuses and kinds are `text` with a `CHECK`, not PostgreSQL enums.** The domain types are the
source of truth for the closed sets, and a `CHECK` tracks them with an ordinary migration where
`ALTER TYPE ... ADD VALUE` is a separate dialect with its own transaction rules.

**Both halves of the golden/version pairing are enforced, in different places.** That a changed
golden file carries a bumped version is a git comparison, so it is a CI script. That the golden
file's version equals the version the registered method actually reports is a fact about a live
object, so it is a test. Neither could do the other's job honestly.

**`selectNowSet` takes limits as an argument and has no default.** OQ-2 is open. A
`CANDIDATE_SELECTION_LIMITS` constant carries the candidate values the question itself names, and
its doc comment says it decides nothing — the real value is picked at the first review, as OQ-2 asks.

**A hard blocker is reported ahead of a policy cap.** When an initiative is both blocked by an
unfinished dependency and in an area that already holds a slot, the reason returned is `blocked`.
"Waiting on X" is actionable; "your area is full" is not. See *Surprises* for where this meets the
worked example.

No ADR was contradicted, and none was needed.

## Surprises

**The worked example and the fixtures give different reasons for the same outcome.**
[`../12-scoring.md` §6](../12-scoring.md#6-worked-example) says the draught-proofing row is not
selected because its area already holds a `now` slot. `fixtures/initiatives.json` additionally makes
that row depend on the in-flight one, so the first reason encountered is the dependency. Both are
true, the outcome is the same, and the test asserts the outcome from the specification and the
reason from the implementation, with the discrepancy written down rather than smoothed over. Nothing
needs to change unless the reason codes reach a surface, at which point the example's prose is worth
one extra clause.

**The self-dependency `CHECK` never fires.** A `BEFORE ROW` trigger runs before table constraints,
so the cycle trigger catches a self-edge first and reports it as a one-step cycle. The constraint
stays: it is the guard if the trigger is ever dropped, and it costs nothing.

**Zod's `.optional()` and `exactOptionalPropertyTypes` disagree.** Every optional entity field is
declared `?: T | undefined` rather than `?: T`. These are parsed boundaries — an ingested record can
carry an explicit `undefined` — so the wider type is the honest one, but it is a repo-wide
convention now and worth knowing before the next package hits it.

**Both new gates were watched fail before being trusted**, following the discipline W00 set. The
purity lint rule was probed with a file importing `node:fs` and calling `Date.now()`,
`Math.random()` and `new Date()`: all four fire. The golden gate was probed by editing a pinned score
without a version bump (fails), then bumping the version (passes). The migration was applied to a
throwaway PostgreSQL 17 and each guard attacked: an off-scale 4, an `origin` update, a weight with
no year, a dependency cycle, an `UPDATE` and a `DELETE` on `initiative_score`, a second binding of
one external object, an automatic low-confidence link, a Run budget on a non-Run area, and a `done`
status with no date. Every one was refused, and the cycle rejection printed the full path.

## Follow-ups

- **`images` does not apply migrations.** Nothing in CI runs `0002_domain.sql` against a real
  database, so the SQL in this pull request is verified only by the manual run recorded above. A
  PostgreSQL service container in the `test` or `images` job would make it a standing check. Owner:
  whoever next touches CI — worth doing before W04 writes anything.
- **No Drizzle schema.** Deliberate: the brief puts persistence wiring beyond the migrations out of
  scope. W05 and W04 will want `packages/db/src/schema/`, generated or hand-written against these
  tables.
- **Cross-table invariants are not enforced in SQL.** That an initiative's area is `kind = 'area'`,
  and that `area_weight` sums to 100 for a year, are checked in the domain layer only. Both would
  need a trigger; neither seemed worth one before there is a writer.
- **`assertAcyclic` is recursive.** Fine for a few hundred initiatives, and it is the only recursion
  in the package. If the backlog ever reaches a depth that matters, it becomes an explicit stack.

## Specs touched

None. The model was frozen on 2026-09-15 and nothing here needed it to move. `STATUS.md` gains the
`golden fixtures` check in its required list, and the journal index gains this entry.

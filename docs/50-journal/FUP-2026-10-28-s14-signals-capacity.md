# FUP · 2026-10-28 · S14: the specs agree that Signals do not count toward capacity

**Agent:** Claude · **Duration:** one run · **PR:** [#199](https://github.com/vchatela-org/prisme/pull/199) · **Outcome:** `12-scoring.md` §4 and
`10-model.md` §3 are corrected to what ADR-0014 decided and the code does. Docs only. S14 is closed.

## What was found first

The finding offered two ways out: correct `12-scoring.md`, or decide otherwise in an ADR. There was
nothing to decide. [ADR-0014](../20-decisions/0014-lanes-outside-the-backlog.md), Accepted, says
*Run counts toward capacity; Signals do not*, and `laneOf` (`apps/sync/src/backfill/attribute.ts`) and
`computeCapacity` both give a Signals completion zero minutes. A second sentence carried the same
drift: `10-model.md` §3 said *Run and Signals … included in capacity accounting*, contradicting its
own §9.

## What was done

- `12-scoring.md` §4: *Run counts toward capacity but never toward ranking; Signals count toward
  neither*, citing ADR-0014 and the code.
- `10-model.md` §3: the same, pointing to §9.
- `19-how-it-works.md` S14 records the correction.

## Decisions taken

- **The ADR wins over the drifted spec**, as `CLAUDE.md` §5.7 requires; no new ADR, because nothing
  changes.

## Checks run locally

`scripts/check-doc-links.py` (the internal-links check); prettier; the privacy scan
with the local supplement.

## Specs touched

- `docs/12-scoring.md` §4, `docs/10-model.md` §3, `docs/19-how-it-works.md` S14.

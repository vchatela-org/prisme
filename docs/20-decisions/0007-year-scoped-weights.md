# ADR-0007 · Area weights are year-scoped

**Status:** Accepted · 2026-09-15

## Context

Area weights express what the user has decided matters. They should evolve — life changes — but not
continuously, and above all not in response to what has already happened. A weight adjustable in the
moment will be adjusted to match observed behaviour, which destroys the only reference point the
system has.

Weights had also been stored inside page titles and section names in the external tools, which is
why nothing could compute against them.

## Decision

```
area_weight (area_key, year, weight_pct)     PRIMARY KEY (area_key, year)
```

Fixed for a whole calendar year, decided at the yearly review, **read-only in the UI in between**.
Every balance factor and KPI computes against the weight in force at that time.

There is no "current weight" anywhere in the schema. Asking for a weight always requires a year.

### The year gate

A year with no weights does not silently inherit. Balance factors are marked `stale`, a persistent
banner appears, and the **Year Review** surface unlocks — declared versus observed for the year
ending, trends across all history, objective attainment, throughput. Weights carry forward until
set, loudly rather than silently.

## Consequences

- Historical charts stay correct after new weights land, because each period is evaluated against
  its own weights.
- The annual decision becomes unavoidable at the moment it is due, and is made against evidence
  rather than memory.
- Mid-year rationalisation is structurally impossible.
- A genuine mid-year change of circumstances cannot be reflected until the next review. Accepted:
  that rigidity is the mechanism, not a side effect.

## Alternatives

**A single mutable weight.** Rejected: destroys history and invites rationalisation.

**Quarterly weights.** More responsive. Rejected: four decisions a year is enough friction to be
skipped, and a quarter is too short for the balance factor's four-week window to mean much.

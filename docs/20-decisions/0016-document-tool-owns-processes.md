# ADR-0016 · The document tool owns process pages outright

**Status:** Accepted · 2026-09-15

## Context

Run — recurring upkeep — is budgeted in hours per week (ADR-0014 records the lane model). Measuring
it requires a duration per recurring task, and that already exists: the document tool holds process
pages carrying a declared duration and frequency.

The question was whether prisme should take ownership of those pages, mirror them, or read them.

## Decision

**The document tool owns process pages outright. prisme reads duration and frequency, and writes
nothing there.**

The integration's access to that database is **read-only**.

## Consequences

- Run hours are computed by joining the two tools — completions of a recurring task × the declared
  duration of its process page — with no new data entry.
- Process pages continue serving their much wider purpose: they are written procedures, including
  the review rituals prisme itself follows. prisme has no authority over them.
- Read-only access narrows the integration token's blast radius. A bug cannot corrupt an archive
  that predates the application ([`14-threat-model.md`](../14-threat-model.md)).
- Declared durations may be stale, so Run hours are an estimate. Acceptable — a budget cap needs an
  order of magnitude, not precision.

## Alternatives

**prisme owns durations.** Rejected: duplicate maintenance, and it takes ownership of a document
that serves purposes prisme knows nothing about.

**Mirror process pages into prisme.** Rejected: a copy that drifts, for no gain over reading them.

**Rewrite the sync block so prisme pushes something back.** Rejected: prisme has nothing useful to
contribute today. The one thing it *could* contribute later — *observed* duration from completion
history, alongside the declared estimate — is a single opt-in property write, tracked as OQ-7, not
a reason to take ownership now.

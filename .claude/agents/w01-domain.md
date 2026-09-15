---
name: w01-domain
description: Builds prisme's pure domain package - entities, invariants, the pluggable scoring registry, wsjf-balanced, capacity computation and now-set selection. Wave 1, no dependencies. Highest-leverage workstream.
---

Execute workstream **W01 · Domain model and scoring registry**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W01-domain-scoring.md` — your contract
3. `docs/10-model.md` and `docs/12-scoring.md` — the specification
4. `packages/domain/CLAUDE.md`
5. `docs/50-journal/INDEX.md`

This is the heart of the system and everything downstream is wrong if it is wrong. It is also pure —
no I/O, no clock, no randomness — which makes it the easiest thing in the repository to verify
properly. Take the time.

The invariants that matter most:
- **Nothing outside `scoring/` may read a method-specific field.** No `wsjf` column, ever. Add the
  lint rule yourself; it is what keeps ADR-0006 true a year from now.
- **A weight always requires a year.** Do not add a "current weight" accessor.
- **Fibonacci inputs are a union type**, not `number`, so an invalid 4 or 6 cannot be constructed.
- Reproduce the worked example in `docs/12-scoring.md` exactly, including the two cases where
  ranking and selection disagree. `fixtures/scoring/wsjf-balanced.golden.json` pins it.

Finish by appending a journal entry and updating your row in `STATUS.md`.

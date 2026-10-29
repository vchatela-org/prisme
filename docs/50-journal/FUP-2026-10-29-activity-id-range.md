# FUP · 2026-10-29 · The activity log's ids are beyond the safe-integer range, and the schema refused every page

**Agent:** Claude · **Duration:** one run, after the v0.21.0 pin · **PR:** this branch's pull request ·
**Outcome:** a patch, v0.21.1. The activity-log schema no longer validates an event's id as an integer.

## What was found

- **The first backfill after the v0.21.0 pin failed on its first page.** The log's ids are not safe
  integers (a live entry reads 2.17 × 10^36). The schema required an integer, so the connector refused
  every page with `too_big`, and the pass stopped before its first write. The completion history stayed
  at its 288 rows.
- **The incremental passes were unaffected**, because they do not read completions. The daily full pass
  reads them, so its completion step would fail from the next full pass until this is released.
- **Nothing was written wrongly.** The read fails before any write, so the stored figures are the ones
  from before the pin.
- **The tests did not catch it.** Every activity fixture used small ids, and the schema's integer check
  was never exercised at the scale the tool issues.

## What was decided

- Nothing reads an activity event's id, so the schema accepts any identifier for it and reads none of
  it. Validating a field the code does not use only added a way to fail.
- The fix is a regression test that reuses a live-shaped event with an id beyond the safe-integer range,
  red before the change, green after.

## Not done

- Other activity fields were not re-checked at live scale. Their values are strings, booleans or
  ordinary dates in the log, and the contract tests read them.
- A fixture set that mirrors the live id scale across every test is a follow-up. The one regression
  test is enough for this defect.

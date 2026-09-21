# FUP · 2026-09-21 · The materialised weeks reach the dashboard

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes W13's first follow-up: *"Wire `capacity_week` into `/areas` and `/kpi` — the materialised
rows exist and nothing reads them; the dashboard still aggregates `task_mirror`, which is the anchor
subtree only."* Until now the whole point of the workstream — observing capacity from the **full**
completion record rather than from whatever fraction of a life happens to sit under an anchor — was
computed, materialised, and read by nobody.

## What was done

- **`ApiStore.capacity`** — `weeks(from, to)` over `capacity_week`, and `coverage()` over
  `backfill_cursor`. The API reads the backfill's output rather than re-deriving attribution or the
  duration preference order, both of which live in `apps/sync/src/backfill/` and are applied once.
- **`computeCapacityFrom`** in `packages/domain` — the balance rule, from totals somebody else
  already measured. `computeCapacity` now totalises its completions and delegates to it, so the two
  entry points share **one** implementation of the share, the clamp, the lane rules and the Run
  budget. A test asserts the two agree by comparing outputs for the same totals rather than by
  comparing two sets of expected numbers, because two sets of numbers can both be edited to match a
  regression.
- **`/balance` and `/kpi`** measure from `capacity_week` when the backfill has covered the window,
  and fall back to the anchor subtree when it has not — reporting `observedSource` either way, and
  `observedThrough` on the balance.
- **A sentence on the two screens** saying which record the reading came from. The two disagree, so
  an unlabelled number cannot be compared with last month's.
- **`/kpi` gains its first integration coverage.** It had a route declaration and no test against a
  real database; the new assertions are its first.

## Decisions taken

**The API reads the backfill's output; it never re-derives it.** `completion_history` stores the
external *location* and not an area, deliberately, so attribution is re-made from `area_mapping` on
every pass (W13). Doing that in the API would be a second implementation of a rule that already
exists once — and the duration preference order with it.

**The fallback exists, and it is labelled rather than silent.** A fresh instance has no
`capacity_week` at all. Reading it alone would turn every dashboard into a wall of zeroes — a
visible regression for everyone who has not run a backfill — so the anchor subtree is used instead,
and `observedSource` says so. The two sources give different numbers for the same week; a response
that picked one without saying which would be worse than either.

**When the materialised source is used, the window is defined in whole weeks.** `capacity_week` is
week-granular — one row is a whole Monday-to-Sunday week — so counting back from the week `asOf`
falls in keeps the window `windowWeeks` long *and* makes every row it reads a row it uses entirely.
Snapping the day window onto weeks would have counted up to six days outside the window it reports.
The fallback keeps the day-precise window, because that is what its data can be filtered by; a test
asserts both, and that is why the balance test now pins two different `from` dates.

**The coverage date is reported on the balance.** The backfill is a command a human runs, not a
schedule, so the materialised history's coverage can end before the window does. A reading whose
coverage is short under-reports, and the reader can only see that if the response states it.

## Surprises

**`/kpi` had never run against a database.** Not a defect in this change, but worth recording: the
route existed, declared its scope, appeared in the OpenAPI document and the MCP manifest, and no
integration test had ever called it. Two of these tests are its first, and the shape assertion in
them found nothing wrong — which is its own kind of luck.

**`/kpi`'s monthly buckets and `capacity_week`'s weeks share a convention already.** `bucketStart`
assigns a completion to the bucket its *instant* falls in; a week is assigned to the bucket its
*Monday* falls in. Both are "the Monday decides", so a week is never split between two monthly
buckets — which is what makes summing weeks into a month exact rather than approximate. Worth
writing down, because the alternative reading (split the week) is the obvious one.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| `review/year` and the area detail still call `minutesCaveat` without the source | The two other surfaces with a minutes chart do not say which record they are reading. Small, and they read the same endpoints | a later follow-up |
| Nothing schedules the backfill | `capacity_week` stops being refreshed the day the human stops running the command, and the balance then reads stale weeks while saying `capacity_week`. The `observedThrough` date is what makes that visible | a later follow-up |

## Checks

Locally before pushing:

| Check | Result |
|---|---|
| `npx vitest run` (both test database URLs set) | 1 937 passed, 110 files |
| `tsc -b` and `tsc --noEmit -p apps/web/tsconfig.json` | clean |
| `eslint packages/domain/src apps/api/src apps/web/src` | clean |
| `prettier --check .` | clean |
| `pnpm build` | all packages and three apps |
| `./scripts/privacy-scan.sh` | clean, 43 patterns |
| `apps/api/src/mcp/tool-manifest.json` | regenerated with `vitest -u`; the diff is the two new balance fields and the one new KPI field, and nothing else |

## Privacy

Fixture and invented data only. The new integration tests build their `capacity_week` rows in the
test, from fixture areas (`health`, `money`) and invented week starts; the `backfill_cursor` rows
carry invented dates. No real area key, project, task, weight or workspace identifier appears in
this entry or in the diff. The deny-list and secret scans are green.

## Specs touched

[`docs/12-scoring.md`](../12-scoring.md) §4 describes the rolling-window measurement and is
implemented as written; the note about which record the window is measured from belongs to W13's
entry and the DTO, and was not a spec divergence. No ADR is touched.

# FUP · 2026-10-29 · D6: a label can put a task in the Signals lane

**Agent:** Claude · **Duration:** one run · **PR:** see the STATUS row · **Outcome:**
[ADR-0041](../20-decisions/0041-a-label-can-put-a-task-in-the-signals-lane.md), Accepted (the owner
chose a lane label on 2026-10-29). Settings now names one label and the Signals lane it puts work
in. A task carrying the label is a signal wherever it sits. With no label chosen, nothing changes.

## What was found first

- **Lanes are decided in two places, both by location.** The backfill's `attribute` resolves a
  completion's area from `area_mapping` (section, then project), and `laneOf` reads the area's kind.
  The adoption scan's `adaptTasks` does the same for open tasks. Nothing else decides a lane. The
  API reads the materialised `capacity_completion` and `capacity_week` and does not attribute
  anything itself.
- **Completions carried no labels.** The completion wire schema read the id, location, title and
  duration, and `completion_history` stored only those. The endpoint returns the task itself, labels
  included, so the connector reads them now. Without storing them, attribution could not be re-made
  from history, which is 0006's rule.
- **More than one Signals lane is possible.** The new-area form offers one, and neither the database
  nor the API enforces that. So the setting names its lane rather than finding "the" Signals area.
- **`run_budget_hours_per_week` is already on Settings.** The area details form edits it for a Run
  lane. Nothing was built. The instance's Run lane simply has no budget set yet.

## What was done

- **Connector.** `wireCompletedItemSchema` reads `labels` (optional), `mapCompletion` sorts them, and
  `Completion.labels` is absent when the tool sent none. The fixture now has an empty list, an absent
  list and an unsorted one, and the contract test pins all three.
- **Storage.** Migration 0026 adds `completion_history.labels text[]` (`NULL` = not known) and
  `signals_label_setting` (singleton: label, `area_key` referencing `area` and cascading on delete).
  The reversal procedure is in its header. The fetch's upsert keeps held labels when a response has
  none, and replaces them with an empty list when the response says there are none, which is the
  title's rule. Labels cross `unnest` as one JSON text per row, because `unnest` flattens a
  two-dimensional array.
- **Sync.** `signalsAreaByLabel` (`apps/sync/src/signals-label.ts`) is the single rule. `attribute`
  asks it before the location, and so does `adaptTasks`. A labelled task with no mapping is a signal,
  not a gap. A label naming an area that is no longer a Signals lane is ignored.
- **API.** `GET`/`PUT /settings/signals-label` (`admin:settings`). `label: null` turns it off. A
  label needs an area of kind `signals` (`422`, `404` for an unknown key). The body refuses
  `prisme` and anything starting with `prisme:` (`400`).
- **Web.** *Settings → Signals lane label*: the label, the lane (preselected when there is one), Save
  and Turn off. With no Signals lane the form says to create one first.
- **Docs.** ADR-0041 and its index row (0014 marked as widened), `10-model.md` §3 and §9,
  `11-ownership.md` §5, `12-scoring.md` §4, `16-sync.md` (capacity refresh), `18-user-guide.md` §2.1
  and `19-how-it-works.md` §3.4 and §3.6.

## Decisions taken

- **The label beats the location for Signals only.** It never moves work into an area or into Run,
  because those count as chosen time.
- **It applies to open tasks too.** The adoption scan uses the same function, so a labelled task is
  classified as a signal and never proposed as an initiative. A completion and the open task it came
  from cannot be placed by two readings of the same setting.
- **No change to the reconciler.** Its location lookups decide where an *anchor* belongs and which
  area a hand-labelled initiative joins. Neither is a lane decision.

## Checks run locally

Node 24.21.0, where the repository pins 26, so CI validates the runtime. Run locally: the connector
contract test; the sync backfill and adoption unit suites; the backfill and adoption store
integration suites and the API settings integration suite, each against a throwaway `prisme_test_*`
database; typecheck for sync, API and web. The pull request lists the rest.

## Not done

- **Older history is not re-fetched.** Completions recorded before 0026 have no labels on record,
  and their location decides until a fetch covers them. The daily refresh covers the trailing window,
  and older weeks need `prisme-sync backfill --from` earlier than the cursor's start.
- **No event is written when the label changes.** `updated_at` is the only trace, as for the
  work-in-progress limits.
- **One label, one lane.** A second label, or a label for Run, would be a new decision.

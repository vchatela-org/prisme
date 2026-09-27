# FUP · 2026-09-27 · An area's observed share can be taken apart

**Asked:** the owner opened an area whose observed share sat far above its declared share, and
asked which tasks that was. The area screen gave the share, the target and a count, and nothing
under them. The owner chose to record titles rather than read them live, and to fix the stale
balance in the same change ([ADR-0032](../20-decisions/0032-completed-task-titles-are-recorded.md)).

## What was there

- `capacity_week` holds a count and a sum per week and area. `materialise` attributed every
  completion to an area, a lane and a number of minutes in memory, summed them, and discarded the
  rows. Nothing below the weekly sum survived.
- `completion_history` kept no title. The completion endpoint sends one, and `mapCompletion`
  dropped it, as `docs/11-ownership.md` §5 required.
- **The daily capacity refresh fetched nothing.** [#76](https://github.com/vchatela-org/prisme/pull/76)
  made the full pass re-materialise the trailing window, and its register row is 🟢, but
  `completion_history` still grew only when somebody ran `prisme-sync backfill`. The balance was
  current with a history that had stopped at the last backfill.

## What was done

- **ADR-0032:** a completed task's title is recorded, read-only. The owner stays the task tool.
  §5's Content row is split: completed-task titles are recorded; open-task content, descriptions and
  subtasks are still never mirrored.
- **Migration 0014:** `completion_history.content` (nullable, commented as instance data), and
  `capacity_completion`, one derived row per attributed completion (area, lane, minutes, the tier the
  minutes came from).
- **Connector:** `Completion.content`, through the same plain-text sanitiser a live task's title
  goes through.
- **Sync:** `recordSlice` stores the title and never erases one with an empty response.
  `replaceMaterialised` rewrites both derived tables in one transaction over the same weeks. The
  refresh fetches `[min(cursor end, now − window), now)` in 28-day slices before it materialises,
  and a failed fetch is reported as `taskToolUnread` without failing the pass. `toStoredCompletion`
  copies fields one by one, so a field the connector gains later cannot reach history unnoticed.
- **Domain:** `countCompletions`, the per-completion list the anchor-subtree fallback uses;
  `computeCapacity` now totals through it, so that list cannot drift from the numbers.
- **API:** `GET /areas/{key}/completions` (`listAreaCompletions`, `read:areas`). Its window comes
  from `measurementWindow`, the function `/balance` now calls too.
- **Web:** *Completed in the window* on the area page: a summary line built from the API's totals,
  a table of what was counted with each row's minutes and their source, an empty state, an error
  state, and a note when the list and the balance row disagree. On `/areas`, "N completed" links to
  it.
- **Checked by running it**, not only by the suites. On a throwaway database, the branch's own
  `refreshCapacity` ran with a fake task client serving invented completions in fixture areas. The
  harness then served the page, where the list's totals matched the tile and the balance row, a
  completion in the partial week before the window was fetched and not listed, an unmapped one was
  stored and attributed nowhere, and a row held from before titles read *Title not recorded*.
  Deleting one itemised row showed the gap note; an area with nothing showed the empty state.

## Decisions taken

- **Record titles, no live read** (the owner's choice). A live read would add a failure mode on
  every page view and run into the endpoint's three-month cap, and it would show nothing the stored
  title does not.
- **A derived table, not an area on history.** Migration 0006 forbids a stored `area_key` in
  `completion_history` because it freezes a mapping decision. `capacity_completion` is rebuilt on
  every run, so a changed mapping re-attributes it without a fetch.
- **The refresh starts at the earlier bound.** Starting at the window's start after a missed day
  would advance the cursor over a stretch nothing had read.
- **The response carries `ritual` and a nullable `minutesSource`, not the lane.** The screen needs
  those two facts. A Signals completion is labelled `recorded` in `capacity_completion` only because
  the column is `NOT NULL`, and the API reports it as having no tier, since no time was counted.
- **The gap note does not promise that the daily sync closes the gap.** That sync re-reads the
  trailing window only, so a past year's weeks are itemised by a backfill.

## Surprises

- **`materialise` rewrote the first week of its window from part of that week.** It loaded
  completions from the window's instant while deleting and rewriting whole weeks. The refresh starts
  mid-week six days out of seven, so the first week lost its earlier days every night. It now loads
  whole weeks. The bug predates this change; it surfaced while writing the per-completion rows.
- **A backfill cannot re-fetch a range its cursor covers.** `planResume` resumes at the cursor's
  end unless `--from` is earlier than the cursor's start. Titles for history older than the trailing
  window therefore need a `--from` before the cursor's start. Any backfill run re-materialises the
  whole covered range, so itemising older weeks needs no such care. The ADR and `docs/16-sync.md`
  say this.

## Follow-ups

- **Deployment, outside this change:** cut a release and pin it. The first daily full pass after
  that fetches the trailing window, records its titles and fills `capacity_completion`. Until then
  the area page shows the gap note.
- **Not done, deliberately:**
  - drilling into a past month from *Share over time*: the API already takes `year` and `weeks`, so
    this is a screen change only;
  - linking a completion to its initiative, or to the task in the task tool;
  - an MCP read tool for the list, which would put task titles into an agent's context and needs a
    decision of its own;
  - re-fetching titles for history older than the trailing window, which is a manual backfill as
    described above.

## Specs touched

[ADR-0032](../20-decisions/0032-completed-task-titles-are-recorded.md) and the ADR index ·
`docs/11-ownership.md` §2 (the derived completions row) and §5 (the Content row split) ·
`docs/16-sync.md` §2 (the refresh fetches, rewrites whole weeks and both derived tables) ·
`docs/18-user-guide.md` §5.

# ADR-0032 · A completed task's title is recorded, read-only, so the capacity figures can be taken apart

**Status:** Accepted · 2026-09-27 — amends the Content row of [`11-ownership.md`](../11-ownership.md) §5

## Context

The area screen showed an area's observed share (half of the window's attributed time, say, against
a fifth declared) as a number, and "completed in the window" as another. The owner asked which tasks
that was, and nothing in prisme could answer:

- `capacity_week` holds a count and a sum per week and area. `materialise` attributed each completion
  to an area, a lane and a number of minutes in memory, summed, and discarded the rows.
- `completion_history` holds the id, the location, the instant and the duration, but not the title.
  The task tool's completion endpoint sends one, and `mapCompletion` dropped it. That was deliberate:
  §5 of the ownership matrix said task content is "Never mirrored, only counted".

A list of task ids does not answer "which work was that?". The explainability rule in
`apps/web/CLAUDE.md` exists for this: a share nobody can take apart gets overridden once and then
ignored.

There are two ways to get a title onto the screen: record it when the completion is fetched, or ask
the task tool for it each time the list is shown. The completion endpoint serves at most three months
per request, and prisme's history already reaches further than that because the backfill fetches in
28-day slices.

Writing this showed a second defect. The daily capacity refresh re-materialised `completion_history`
but never added to it. Only `prisme-sync backfill`, a command a person runs, fetched completions, so
the balance stayed at the last backfill while the screen called it current.

## Decision

**1. prisme records the title of a completed task, and nothing else of its content.** The
completion's `content` is stored in `completion_history.content`, sanitised to plain text by the
sanitiser a live task's title goes through. The description, subtasks, comments and attachments are
still not read into history, and an **open** task's title is still not recorded anywhere.
`toStoredCompletion` copies the stored fields one by one rather than spreading the connector's
record, so a field the connector gains later does not reach history without a decision.

**2. The owner does not change.** The title is the task tool's field. Its row in §5 stays **T ←**:
prisme reads it and never writes it. What changes is the note "Never mirrored, only counted". It now
reads **recorded read-only for a completed task**. [ADR-0008](0008-field-level-ownership.md) is kept:
one owner per field, and this field has exactly one.

**3. A completion keeps the title it had when it was fetched.** A re-fetch refreshes it
(`coalesce(excluded.content, completion_history.content)`), and a response without one never erases
it. The daily refresh re-fetches only the trailing window, so a task renamed after its completion
left that window keeps its older title. The screen says so: "a title is the one the task had when
prisme fetched it".

**4. No live read.** The list is served from what is stored. Asking the task tool as well would add a
failure mode (a slow or unreachable tool, a three-month cap, a token prisme would need on every page
view) without showing anything the stored title does not.

**5. The attributed rows are kept, as a derived table.** `capacity_completion` holds one row per
attributed completion (area, lane, minutes, the tier the minutes came from). `replaceMaterialised`
rewrites it in the same transaction and over the same weeks as `capacity_week`, so the list and the
sums cannot disagree. It is disposable and recomputed on every run. That keeps migration 0006's rule:
no area is ever stored in `completion_history`, because a stored area would freeze a mapping decision.

**6. The daily refresh fetches before it materialises.** The full pass's capacity refresh reads
`[min(cursor end, now − window), now)` from the task tool in 28-day slices, through the same
`recordSlice` the backfill uses. It starts at the earlier bound so that a refresh that missed days
never leaves a hole the cursor claims to cover. It is the read path only, so it runs under the write
freeze, and a failed fetch is logged as `taskToolUnread` and the pass still materialises what is
stored.

## Consequences

- `GET /areas/{key}/completions` (`read:areas`) lists what an area's row of `/balance` counted, over
  the same window, chosen by the same function (`measurementWindow`). The area page shows it under
  *Completed in the window*.
- Titles are instance data at rest. They fall under asset A4 in
  [`14-threat-model.md`](../14-threat-model.md) like every initiative title prisme already holds.
  They are never logged, never committed ([`17-privacy.md`](../17-privacy.md)), and no MCP tool
  exposes them. A token with `read:areas` can read them over REST, as it can read the areas
  themselves.
- Rows fetched before migration 0014 have no title. The trailing window gets titles at the first full
  pass after deployment. Older history gets them only when it is fetched again:
  `prisme-sync backfill --from <date>` with a date **earlier than the cursor's start**, which re-reads
  everything from that date (`planResume`'s *extended backwards*). A `--from` inside the covered range
  resumes at the cursor's end and re-reads nothing. Until then the screen shows "Title not recorded".
- Any backfill run, even one with nothing to fetch, re-materialises the whole covered range, so it
  itemises older weeks into `capacity_completion`. Where `capacity_week` counts more than
  `capacity_completion` lists, the screen says why instead of letting the two disagree silently.
- The balance no longer depends on somebody re-running the backfill. It is as current as the last
  daily full pass.
- The fallback source, the anchor subtree (`task_mirror`), still has no title by design. When the
  balance reads from it, the list shows ids and minutes without titles.

## Alternatives

**Read titles live when the list is shown.** Rejected (decision 4): a network call on every page view
for data that almost never changes after completion. The request cap also means a year of history
would take four calls or more.

**Both: store titles, and read live to refresh them.** Rejected for the same reason. The trailing
re-fetch already refreshes the titles that matter, the ones in the window the balance measures.

**Store `area_key` on `completion_history` instead of a derived table.** Rejected: it is exactly what
migration 0006 forbids. A mapping changed later would leave history attributed the old way, with
nothing to recompute it.

**Keep the refresh fetch-free and document "run the backfill".** Rejected by the owner. A chart that
is current only when somebody remembers a command is not current.

## Revisit when

- a screen needs a completed task's description or subtasks (that would be a new row in §5 and a new
  record, not an extension of this one);
- an agent needs the list (it would need an MCP read tool, and a decision about putting task titles
  into an agent's context, as [ADR-0031](0031-outward-writes-are-audited-and-pruned.md) had to make for
  what was sent);
- titles older than the trailing window drift enough from the task tool to matter.

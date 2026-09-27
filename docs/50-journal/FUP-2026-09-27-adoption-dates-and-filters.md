# FUP · 2026-09-27 · The adoption queue hides what has ended, and filters

**Asked:** working the queue, the owner found it full of entries whose period was long over, such as
objectives for a year two years gone. Such an entry is finished in the document tool, not archived,
so nothing set it apart from this year's. They proposed choosing, per store, the column that holds
the relevant date, as an optional setting, so that only undated, running or future entries are
considered. They also asked for filters on the queue, by date or by source, "whatever is relevant".

## What was there

- The scan's only notion of finished was `archived`. A document-tool record's `closed` is the
  tool's archive flag, and an archived page never comes back from a query anyway.
- `adoption_candidate` recorded neither which store a page came from nor any date. The API filtered
  by `areaKey` and `kind` only, and the screen used neither.
- The connectors already parsed a `date` property into `{ start, end }` calendar days. The binding
  check already read the data source, for its title.
- Property names reach the adapter as configuration, never as literals
  (`DOCTOOL_TAKEAWAY_TYPE_PROPERTY`). That is the precedent for a date property's name being
  instance data.

## What was done

- **Migration 0015.** `role_binding.date_property`, the chosen column, and
  `role_binding.date_properties`, the date-typed columns the last check found. Also
  `adoption_candidate.source_role`, `starts_on` and `ends_on`, with CHECKs: only a page has a store,
  and a period runs forward. The reversal was **rehearsed** on a throwaway database: migrate to
  0015, run the written reversal (the five columns gone), migrate again (0015 re-applied), then drop
  the database.
- **The check lists date columns.** `describe` reads each property's type from the data source and
  returns the names of the `date` ones, sorted. A pasted database link gets one extra read of its
  data source for this. If that read fails, the date list is dropped and the binding is not, because
  a store prisme can read is not refused over an optional list.
- **Settings → Notion** offers a *Date column* select for Objectives, Takeaways and Processes, the
  three stores whose entries reach the queue. `PUT /bindings/{role}/date-property` only accepts a
  name from the last check's list. A re-check keeps the choice while the store still has that
  column, and drops it once it does not.
- **The scan** reads each entry's period from its store's chosen column: a range as it is, a single
  date as a one-day period, a backwards range put in order. It records the store and the period on
  the candidate.
- **The queue** (`GET /adoption/queue`) takes `when` (`open` by default, or `current`, `upcoming`,
  `undated`, `ended`, `all`), `source` (a role key, or `project` / `task`) and `areaKey` (a key, or
  `_none`). Each row carries its `period` and the response carries `today`. Beside every filter
  value is a count, taken over the rows matching the *other* filters, so the number is what clicking
  it shows. One pure function (`services/adoption-queue.ts`) filters, counts and pages the whole
  undecided set, so a count and its rows cannot disagree. "Today" is the instance timezone's day,
  not UTC's.
- **The screen:** three rows of filter chips (Date, From, Area), each chip with its count. The
  filters live in the address. A line says how many ended entries are hidden, with a link to them.
  Each row names its source and, when dated, its period and whether it is in progress, not started
  or ended.
- **Tests:**
  - the connector contract: date names only, sorted, the database path, and a failed schema read;
  - the adapter's period rules, and the scan dating by each store's own column only;
  - the store against PostgreSQL: the new columns written, and a backwards period refused by the
    CHECK;
  - the queue function: periods at both boundaries, facets, paging, and the timezone day;
  - the API against PostgreSQL: the default hides ended rows, plus each filter and the facet counts;
  - the Settings route: choose, refuse an unknown name, refuse an unbound or create-only store, keep
    across a re-check, drop on re-pointing, and scope;
  - the web helpers: address parsing, links, labels and the date choice.
- **Checked by running it.** On the harness, with the fixture seed plus six invented candidates
  (two ended, one running, one next year, one undated, one task) and an invented objectives binding
  with two date columns. The default view showed four rows and "2 whose date has passed are hidden".
  *Show them* and the source and *All* chips each showed the expected rows. Choosing the column in
  Settings saved, and it read back from the database.

## Decisions taken

- **Hidden by the queue, not set aside by the scan.** The first thought was to leave ended entries
  out of the mirror, as a loose task is. That was rejected for three reasons:
  - Nothing would say how many were left out.
  - One could not be adopted on purpose, for instance last year's objective kept for the record.
  - "Ended" would be frozen at the scan's date instead of today's.

  Recording the period and judging it when the queue is read keeps all three.
- **Not *ignore*.** Ignore is permanent and means "never this". "This is over" is a fact about a
  date, and it can change when the date does.
- **A range counts until its end; a single date is a one-day period.** An entry dated today is in
  progress, not ended.
- **Chosen, never typed.** A mistyped column name would date nothing, and nothing would say so.
- **No ADR.** The document tool owns the dates, and prisme reads them and writes nothing. The
  chosen column is configuration beside the binding, like a page store's templates. Neither the
  model nor the ownership matrix moves.
- **Filters are source, area and date.** Kind was left out, because it follows from the source
  almost exactly: an objective is proposed as a key result, a process as a ritual. The API still
  takes `kind` for other callers.

## Surprises

- **A Notion candidate cannot be adopted today, only linked or ignored.** *Adopt* refuses a
  candidate outside every mapped area, and `area_mapping` names only task-tool locations, so a page
  never carries an area. That was recorded 2026-09-26 for 79 of 94 candidates. It also refuses a key
  result or a ritual outright (they need an objective or a cadence, which no candidate carries). So
  the objectives and processes stores' rows can only be linked to an entity that already exists.
  This is not changed here; it is the open question the 2026-09-26 entry names (the mapping
  vocabulary), and it needs an ADR.

## Follow-ups

- **Rescan after deploying.** Rows mirrored before 0015 carry no store and no dates. They show
  *From: Notion* and undated until the next scan, daily or *Rescan*.
- **Choosing the column is the owner's**, per store, on Settings → Notion. It needs a *Check again*
  first, since the stored bindings were checked before the check listed date columns.
- **Not done, deliberately:**
  - a status column ("Done", "Abandoned") as a second way to call an entry finished. The date
    answers the question asked; a status can follow if the date proves not enough;
  - a bulk *ignore everything ended*. Ignore is permanent, and hiding already answers the problem
    without making a permanent decision in bulk.

## Specs touched

`docs/13-migration.md` §4 · `docs/15-runtime.md` §2 *External bindings* · `docs/18-user-guide.md`
§2.3, §2.6.

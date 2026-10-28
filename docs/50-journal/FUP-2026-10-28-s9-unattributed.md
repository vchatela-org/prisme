# FUP · 2026-10-28 · S9: Areas counts what no area got, and maps the rest of a project

**Agent:** Claude · **Duration:** one run · **PR:** _pending_ · **Outcome:** Areas lists the
completions the shares counted toward no area, by location, and offers the mapping that would count
them. S9 is closed.

## What was found first

The backfill already counted unattributed completions — `attribute` returns *gaps* grouped by
location — but only into the terminal report of a backfill run. Nothing stored them, and nothing in
the API or on a screen read them. `completion_history` keeps every completion with its project and
section, and `capacity_completion` keeps the ones the refresh attributed, so the difference is
derivable at read time without a schema change.

## What was done

- **`GET /areas/unattributed`** (`read:areas`): over the window `/balance` measured and from the record
  it read, the completions with no attributed row, grouped by project and section, worst first, with
  `partlyMapped` when some section of that project is mapped. Before any backfill the record is the
  anchor subtree, which holds attributed work only, so the list is empty and says which record it is.
- **Areas** fetches it beside the balance, and — only when something was left out — the task tool's
  locations to name it. `UnattributedCard` lists each location with **Map the rest of this project
  to…** or **Map this project to…** and an area select; a completion with no project says to move the
  task instead.
- **`mapRestOfProject`** appends the project-level mapping to the chosen area's mappings through
  `PUT /areas/:key/mappings` — the write Settings → Areas makes, refused the same way when another
  area holds the project.

## Decisions taken

- **The record the chart read, not a second attribution.** A completion is unattributed when the
  refresh gave it no row; re-running the mapping test in SQL would be a second implementation of
  `resolveArea` that could disagree with it. The cost: a mapping added now leaves the row until the
  next daily refresh, and the card says so.
- **A project-level mapping is "the rest".** Attribution is section first, so mapping the project
  itself catches the root and unmapped sections and leaves the mapped sections where they are. No
  new rule.
- **No migration.** Everything was already stored.

## Checks run locally

Node 24.21.0: root `pnpm typecheck`; the whole `unit` project, including `unattributed-view.test.ts`;
the API's integration tests for the new route (the partly mapped project, an unmapped one, the window
edge, and the empty answer before a backfill); eslint and prettier on the changed files; the privacy
scan with the local supplement.

## Not done

- The list does not update the moment a mapping is added; it follows the daily refresh, like the
  shares.
- No MCP tool reads it.

## Specs touched

- `docs/10-model.md` §3 (area mapping), `docs/18-user-guide.md` §2.1, `docs/19-how-it-works.md` S9.

# FUP-2026-09-26 · Settings screens: areas, colours, locations and Notion bindings from the UI

**Date:** 2026-09-26 · **Branch:** `fup/2026-09-26-settings-screens` · **Kind:** follow-up

## Why

The owner asked why areas, their colours, their task-tool mappings and the Notion role bindings could
only be set by editing a gitignored JSON file and running `prisme-sync` as a Job — and could not see,
anywhere, what each role or area actually pointed at. Reading the code answered the first half: the
API has had `POST /areas`, `PATCH /areas/{key}` and `PUT /areas/{key}/mappings` since W05, and **no
screen called them**. The seed path was the only door because it was the only door anybody had
built. The second half had no answer at all: `role_binding` held an identifier and nothing a person
could recognise, and `area_mapping` held two opaque task-tool ids.

## What changed

- **`/settings`** — one overview: whether anything can be written outward (freeze, kill switch,
  create threshold, sync window), every area with its colour, this year's weight and the Todoist
  projects and sections its work lives in **by name**, every Notion role with the **title** of the
  store it points at and what prisme does with it, and the deployment's scoring and capacity
  settings, read-only.
- **`/settings/areas/new`** and **`/settings/areas/{key}`** — create an area or a lane; rename,
  recolour, deactivate, set the Run budget; tick the projects and sections that are the area's, from
  a list read live from the task tool, and mark one as **home**. A location another area holds is
  shown as held, not offered.
- **`/settings/notion`** — paste a link or an identifier per role. The API checks it as it saves,
  keeps the title, and resolves a **database** link to the one data source inside it (a person
  cannot see a data source's id anywhere); a database holding several is refused with a count. A
  failed check still saves, with the failure *kind* beside it — the usual cause is a store not yet
  shared with the integration, and the order a person does those two things in is theirs.
- **Migration 0011**: `area.color_slot`, `area_mapping.is_home` (one per area, by a partial unique
  index), and `role_binding.title / link_id / checked_at / check_error`.
- **API**: `GET /bindings`, `PUT /bindings/{role}`, `POST /bindings/check` (`admin:settings`) and
  `GET /task-tool/locations` (`admin:areas`); areas carry `colorSlot` and each mapping `isHome`.
- **Connectors**: `TaskToolClient.fetchLocations()` (projects and sections only — no task is read),
  `DocToolClient.describe(id, shape)` (a title and the id a person opens; metadata only), and
  `ROLE_SHAPE`, which says whether a role names a data source or a page.
- **One rule for where new work goes** — `homeLocation` in `packages/domain`: the home, else the most
  specific mapping, else the first by identifier. The reconciler's anchor creation took the first
  mapping in key order and the capture flow the most specific, so one area could send new work to
  two places (the user-guide draft's G4). Both now call the same function.
- **Colour**: the root layout merges colours chosen in Settings over `AREA_COLOR_PINS`, and the
  Areas screen's clash notice now links each clashing area to its settings page, keeping the
  generated pin map as the GitOps alternative.
- `TASKTOOL_PROJECT_URL_TEMPLATE` — `DOCTOOL_PAGE_URL_TEMPLATE`'s counterpart, so a mapped project
  can be a link without the repository learning a vendor's URL layout.

## Decisions worth keeping

- **No URL is stored for a Notion store.** The connectors deliberately never read the tool's `url`
  field (it identifies the workspace); a link is `DOCTOOL_PAGE_URL_TEMPLATE` applied to `link_id` in
  the web tier, as *Open page* already was. For a data source, `link_id` is the database holding it,
  because that is what a browser can open.
- **A read role and a create role may not share a store.** Page stores may share one location with
  each other (ADR-0025 says so); prisme creating pages inside a database it also reads as, say,
  takeaways is a configuration nobody means, and it is refused by name.
- **The seed path stays**, and writes the same tables. Loading the bindings file replaces every
  binding, including those set on the screen; the pages and `seed.example/README.md` say so. The
  seed mapping format gained an optional `home`.
- **The anchor fallback changed** from key order to *most specific*. No instance has let prisme
  create an anchor yet — the write freeze is on everywhere — so nothing already created can move
  because of it; the migration's header says the same.

## Verified

Unit (2029) and integration (218, against a dedicated database) suites green on Node 24 locally.
Driven in a browser against the committed harness's provider, with its own database and a throwaway
fake of both tools on spare ports — the running harness was left alone: overview rendered, a colour
and a home location saved and read back from the table, an area created, a database link resolved
to its data source, an unknown store saved with `refused` beside it.

## Specs touched

`docs/10-model.md` (the mapping's home, and where it is edited), `docs/11-ownership.md` (two new
prisme-owned fields), `docs/13-migration.md` §5 (where bindings and mappings are configured),
`docs/15-runtime.md` §2 (bindings from the screen, the new template, colours over pins),
`seed.example/`, `apps/web/CLAUDE.md` (the `(settings)` route group).

## Not done

- **Rituals, dependencies and conflict resolution** still have no screen — separate follow-ups.
- **Weights** stay where ADR-0007 puts them, on the Year Review; Settings links to it.
- **No delete for an area**: deactivating retires one, and every score and capacity week naming its
  key survives. A key never changes, so renaming an area changes only its name.

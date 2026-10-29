# FUP · 2026-10-29 · D7: the task tool's Inbox is no area's

**Agent:** Claude · **Duration:** one run · **PR:** see the STATUS row · **Outcome:** S11's premise,
that the task tool's own Inbox belongs to no area, is now enforced. A mapping that names the Inbox
is refused, as home or otherwise. One that already does is flagged on Settings and on prisme's
Inbox, so the owner can move the home. No ADR: this enforces a rule S11 already wrote down.

## What was found first

- **Nothing stopped the mapping.** `PUT /areas/{key}/mappings` and `POST /areas` accepted any
  project. The connector already read the tool's `inbox_project` flag (S11), but only the Inbox
  listing used it. Settings offered the Inbox like any other project, home included.
- **What S11 did when the Inbox was mapped:**
  - Its completions were attributed to the mapped area, which is the reported symptom.
  - `GET /task-tool/inbox` went on calling its tasks *unsorted, in no area*.
  - *Make it an initiative* of the mapped area left the task in the Inbox, because the reconciler
    moves an anchor only when it sits outside its area, and the mapping says the Inbox is inside.
  - As the area's home, the Inbox is where `homeLocation` sends new anchors and captures.
- **Mappings are written by two API calls**, `PUT /areas/{key}/mappings` and `POST /areas`. The
  web's two writers (the locations form, and *Map this project to…* on Areas) both use the first, so
  the refusal lives in the API.

## What was done

- **API.** The catalogue service reads the tool's locations and refuses (`422`, a message naming
  the Inbox and the way out) any mapping set naming the Inbox project, on create and on replace. If
  the tool cannot be read, the save goes through unchecked, because blocking every mapping during an
  outage would block the rest of Settings, and the flag below catches it later.
  `GET /task-tool/locations` marks the Inbox (`inbox`). `GET /task-tool/inbox` gains `mappedTo`: the
  areas whose mappings name the Inbox anyway.
- **Web.** The locations form greys the Inbox out and never offers it as home. A mapping that
  already names it stays ticked, with the reason beside it, so it can be unticked. The Settings
  overview prints the same warning under such a mapping. prisme's Inbox shows a warning card naming
  the area and linking to Settings. On Areas, the Inbox's completions are listed as counted toward no
  area with no *Map…* action. The two save actions turn the `422` into a sentence saying what to do.
- **Docs.** `10-model.md` §3, `11-ownership.md` §1 (`is_home`), `13-migration.md` §4,
  `18-user-guide.md` §2.2, and `19-how-it-works.md` S11 (*kept true since*).

## Decisions taken

- **Refuse, never ignore.** Attribution and `homeLocation` were left as they are. Silently skipping
  an existing Inbox mapping in the sync would have changed the owner's figures and anchor placement
  without a word. The mapping is shown as a mistake, and the owner removes it.
- **Refuse the whole set, not only a new Inbox row.** A replace that still contains the Inbox is
  refused, so an area that names it cannot be saved until it is unticked. That is the point at which
  the owner sees why.
- **No ADR.** S11 already states that the Inbox is in no area. This change enforces it.

## Checks run locally

Node 24.21.0, where the repository pins 26, so CI validates the runtime. Run locally: the API suite
serially against a throwaway `prisme_test_*` database, the web unit suite, and typecheck for API and
web. The new API tests cover a refused Inbox mapping, as home and not, with nothing written; a
refused new area; a save while the tool is unreadable; and `mappedTo` naming the area. The web tests
cover `nameLocation`'s `inbox` and the unattributed row that offers no mapping.

## Not done

- **The live mapping is not removed.** It is the owner's configuration, and there is no production
  access here. After deploy, the owner unticks the Inbox on the area's Settings page and marks a home
  in the area's own project.
- **The sync does not skip an Inbox mapping.** Until the owner removes it, its completions still
  count toward that area and new work for it can be created there. The warnings say so.

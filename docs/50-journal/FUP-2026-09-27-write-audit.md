# FUP · 2026-09-27 · Every outward write is audited, and the audit is pruned

**Asked:** before lifting the write freeze on the live instance, the owner wanted an audit view of
what prisme does to the document tool and the task tool, with basic filters — and asked whether the
audit was already stored, and kept for a configurable duration, so that only the screen was missing.

**Answer, measured against the code: it was not.** So this run built the storage, the recording,
the pruning, the API and the screen ([ADR-0031](../20-decisions/0031-outward-writes-are-audited-and-pruned.md)).

## What was there

- `event_log` got one `sync_action` row per reconciler action that **succeeded**. A failed call left
  nothing; the row named neither tool nor operation nor what was sent; and it was written for
  actions that only touch prisme's own tables (rollups, status moves) exactly as for one that reached
  an API.
- The creation ledger's calls — projects, sections, captures, pages — left no event at all.
  `creation_intent` keeps an intent's latest state, not a history of calls.
- **Nothing was ever deleted anywhere**, and `event_log` cannot be: its trigger refuses `DELETE`,
  and it is the KPI source and the rollback's before/after.
- `GET /events` existed; no screen listed events.

## What was done

- **`external_write`** (migration 0013): one immutable row per outward call — tool, operation,
  origin (`reconciler` / `creation`), run id, the prisme entity when known, the external object,
  what was sent, outcome, failure kind, message, duration. `UPDATE` refused by trigger; `DELETE`
  allowed, because pruning is its purpose. **`audit_setting`**: a singleton upserted from Settings.
- **The vocabulary and the window are domain rules** — `WRITE_AUDIT_*` and `WRITE_AUDIT_RETENTION`
  (default 90, floor 7, ceiling 3650) in `packages/domain`, repeated as CHECKs.
- **Recording is structural.** `auditTaskToolWriter`, `auditCreationWriter` and
  `auditDocumentCreationWriter` in `@prisme/connectors/write` decorate a writer where it is built;
  the CronJob (reconciler and creation drain) and the API's `POST /sync` hold only audited writers,
  frozen ones included. The entity a call is made for travels in async context
  (`withWriteSubject`) so the writer ports keep the shape the ownership matrix gave them.
- **Pruning** is the last step of the daily full pass, beside the capacity refresh and the adoption
  scan, on the same terms: prisme's own table, runs under the freeze, never fails the pass.
- **API:** `GET /audit/writes` (`read:sync`) with tool, operation, outcome, origin, entity, time
  range and search; `GET`/`PUT /audit/retention` (`admin:settings`). The records carry the entity's
  **current** title beside them, read at query time, because an update or a move sends none.
- **Screens:** `/audit` — period presets, tool/outcome/origin/operation toggles and a search, all
  in the URL; each row expands to exactly what was sent. **Settings** gains *Audit of outward
  writes*: the window, how many records are held and since when, and the form to change it.
- **Checked by running it**, not only by the suites: the migration applied to a throwaway database
  under the production role split (the application role can insert and delete, and nothing else is
  needed), the harness served both screens against invented rows, the filters and search narrowed
  as expected, and a window saved from the form was read back from the table.

## Decisions taken

- **A separate table, not `event_log` with a policy.** Pruning the event log would silently shorten
  the KPIs and break the rollback procedure. The two now answer different questions: the event log
  the *effects*, the audit the *calls*.
- **The write outranks its record.** A record that cannot be inserted is logged, and the call's own
  result stands. The alternative — failing a call the tool already accepted — skips `last_applied`
  and the binding, so the next pass repeats the write; for a create that is ADR-0010's duplicate. The
  cost, a crash between call and insert leaving no row, is written into the ADR.
- **The audit's DTO carries what was sent**, unlike the creation ledger's, which omits `draft`
  because no screen needs it. Here showing it is the screen's purpose. It stays behind `read:sync`,
  is never logged, and no MCP tool exposes it.
- **The window is set on the Settings screen**, the owner's choice over an environment variable,
  consistent with configuration being UI-only since #102.

## Surprises

- The existing `sync_action` event looked like an audit and was not one: success-only, with no tool
  and no payload. A reader of the schema comment ("the security audit trail") would reasonably have
  assumed the question was already answered.
- A move or a priority-only update sends no title, so the first rendering of the screen said
  "no title sent" for exactly the rows a reader most wants to identify. Joining the entity's
  current title at read time fixed it, and the screen labels that title *(title now)* so it is not
  mistaken for something that was sent.

## Follow-ups

- **A task row cannot be opened in the task tool.** The web tier has link templates for a
  document-tool page and a task-tool *project*, and none for a task, so task rows name the object by
  id. A `TASKTOOL_TASK_URL_TEMPLATE` beside the existing two would close it — not added here, since
  it is new deployment configuration nobody asked for yet.
- **No MCP tool reads the audit.** Deliberate (ADR-0031, *Revisit when*): it would put what was sent
  into an agent's context, which is a decision of its own.
- **Lifting the freeze on the live instance is the deployment's next step, and this release is its
  precondition.** The owner's order, decided 2026-09-27: the planned reset **first**, then
  configuration through Settings, then the pin to the release carrying this change, then
  `SYNC_WRITE_ENABLED`. Two things the user guide already says and the lift must not forget: the
  create threshold must be above 0 before prisme can create anything, and the colour pins moved to
  Settings in #102.

## Specs touched

`docs/10-model.md` §10 (the audit, beside the event log) · `docs/11-ownership.md` §9 ·
`docs/13-migration.md` §5 step 9 and §7 · `docs/14-threat-model.md` A5 · `docs/16-sync.md` §2 (the
prune rides the full pass) · `docs/18-user-guide.md` §6 · `apps/sync/CLAUDE.md` (shape, and the rule
that every writer is audited) · ADR index.

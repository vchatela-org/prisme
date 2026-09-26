# FUP-2026-09-26 · Screens for rituals, dependencies and conflict resolution

**Date:** 2026-09-26 · **Branch:** `fup/2026-09-26-rituals-dependencies-conflicts` · **Kind:** follow-up

## Why

Three things the API could do and no screen offered (the user guide's G8, less what the Settings
follow-up covers):

- **Rituals** — `POST /rituals` had no caller. The restore-rehearsal entry recorded the consequence:
  ritual adherence is measured over rituals, and the declared-duration tier joins a ritual's process
  page, so both were empty on every instance.
- **Dependencies** — `PUT /initiatives/{id}/dependencies` had no caller, and the initiative screen
  listed what an initiative waits on **by identifier**.
- **Conflict resolution** — the weekly review's ledger step listed field names and offered no way to
  close one.

## What changed

- **`/rituals`** (new route group, nav entry beside KPI): the defined rituals with cadence, target,
  latest adherence and a link to the process page; a form to define one; inline edit. A pasted
  document-tool link is reduced to its page id (`lib/page-id.ts`).
- **Initiative detail**: dependencies are named by title, and *Edit dependencies* opens a filterable
  checklist of the other open initiatives. A cycle is refused by the API (422) and named in words.
- **Weekly review → conflicts**: each row shows both values and links the initiative; *prisme was
  right* / *the task tool was right — edit the initiative* record the resolution. Resolving moves no
  value: prisme already wrote its own back, and copying an external value into a prisme-owned field
  from a button would blur the ownership `docs/11-ownership.md` fixes — so the second choice takes
  the person to the field instead.

## Verified

Driven in a browser against a throwaway database: a ritual defined, two dependencies saved and shown
by title, a seeded conflict resolved from the review step. Web unit tests (19 files) green;
`page-id.test.ts` is new.

## Not done

- A ritual is not joined to its **recurring task** here — the API has no field for it yet.
  Adherence still has to be recorded (`POST /rituals/{id}/adherence`); computing it from the task
  tool's completions is its own piece of work.

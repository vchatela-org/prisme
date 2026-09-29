# FUP · 2026-09-29 · A recipe for scripting adoption

**Asked:** after an agent brought a Processes database in as rituals through the API, the owner
asked whether the API documentation had been enough to use as it stood.

## What was found

It was not, on six points, each met in the run: the `/api/v1` prefix (a bare path is a 404); which
scopes a workflow needs (found one 403 at a time); that *Link* is `POST /adoption/decisions`, fed by
the queue's own `proposedId`, `matchRule` and `confidence`; that `POST /adoption/scan` answering
`ran: false` means "another pass holds the lock", not failure, and can persist for minutes; that a
Processes row has no area until its store's area column is set (ADR-0033); and that
`adoptRefusal: needs_cadence` stays on a row that is nonetheless linkable. The error messages
themselves were good: they name the scope or field.

## What was done

- **The user guide gains "Scripting the API — adopting in bulk"** (§6, after *API tokens*): where the
  API lives, the scopes the recipe needs, the prerequisite area column, and the loop — read, create,
  rescan, link, ignore — with the two traps (`ran: false`, `needs_cadence`) stated where they bite.
- No code changed, and no route description was edited.

## Decisions taken

None. No ADR raised; nothing here contradicts an accepted one.

## Not done

- **The route descriptions are unchanged.** `scanAdoption` could say "retry on `ran: false`" and
  `decideAdoption` could name `proposedId` as `prismeId`. Small, but a code change with a contract
  test, so its own pull request.
- **No per-workflow scope list in the OpenAPI document.** Scopes are per route; a recipe is the
  cheaper fix.

## Follow-ups

- Whoever next touches `apps/api/src/routes/ops.ts` may fold the two route-description notes in.

## Specs touched

`docs/18-user-guide.md` §6.

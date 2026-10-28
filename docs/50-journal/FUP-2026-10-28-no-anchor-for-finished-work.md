# FUP · 2026-10-28 · No anchor is created for work that finished without one

**Agent:** Claude · **Duration:** one run · **PR:** this entry's own · **Outcome:** the planner no
longer plans a `create` for an initiative in `review`, `done` or `dropped` that never had an anchor

Found while designing S1's *convert to key result*, which drops the initiative it converts. The
planner exempted only `inbox` and `later` from anchor creation (`needsAnchor`), so an initiative
created in prisme and closed before it reached `next` was planned a **create**. That covers a
capture dropped at triage, and an initiative marked done by hand from the inbox. Once writing is on,
that puts a new task for finished work into the task tool. It is the opposite of what the status
says, and nothing in the specs asks for it.

## What was done

- `planUnlinked` (`apps/sync/src/reconcile/plan.ts`) skips an unanchored initiative in `review`,
  `done` or `dropped`, with a skip line saying why. `waiting` still gets an anchor, because it is
  in flight.
- `needsAnchor` is unchanged. It also decides when prisme may write an existing anchor's priority,
  and that rule is not in question here.
- `docs/10-model.md` §5 *The anchor* now says what "next or beyond" means for finished work.

## Decisions taken

- **Strictly fewer creates.** The change can only remove a planned `create`, never add a write, so
  it cannot breach guard 2 (ADR-0010). The planner's create set is still a subset of guard 2's
  predicate, which is all that guard promises.
- **The coverage audit is left as it is.** `wouldProduceCreate` is documented as guard 2's
  predicate, independent of status (it already counts `inbox` initiatives that will not create
  yet). It stays a superset, which is the safe direction for an audit.

## Checks run locally

Node 24.21.0: the `apps/sync` reconciler suites, eslint and prettier on the changed files, and the
privacy scan with the local supplement.

## Specs touched

- `docs/10-model.md` §5.

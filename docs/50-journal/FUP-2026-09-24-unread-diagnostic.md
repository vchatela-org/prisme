# FUP · 2026-09-24 · "Not read" says why, without saying where

**Agent:** Claude · **Duration:** one session · **PR** [#79](https://github.com/vchatela-org/prisme/pull/79) · **Outcome:** complete

The register's row: *"'Not read' cannot distinguish an unbound role from a refused read — the
privacy reason for the swallow stands; the diagnostic gap is real."* It was right on both counts, and
the fix had to keep both: the swallow stays, and the reason comes back in the failure's place.

## Why the swallow exists, and what it was hiding

Both callers of a role read — `adoption/run.ts` and `backfill/processes.ts` — catch the error and
print **"not read"** rather than logging it, because the message names the role *binding*, which is
instance data. `packages/connectors/src/errors.ts` is emphatic about why: an error message is *"the
shortest path from a live workspace into a journal entry"*. That decision is not reversed here.

What it cost was that two opposite facts printed the same six characters:

| What happened | What to do about it |
|---|---|
| The role has **no binding** | Fix the seed file — configuration, minutes |
| The read was **refused** (`invalid_token`, `refused`) | Go and look at a credential or a permission — nothing in prisme is wrong |
| The read was **unavailable** (`rate_limited`, `unavailable`, `transport`) | Wait, or look at the tool's status |
| Anything else threw | Something on the path is not the connector — a bug to chase |

Before this, a first-run instance with an empty bindings table and a deployment with an expired token
produced the same plan line, and the one that says *your token is dead* was the quieter of the two.

## What was done

- **`apps/sync/src/unread.ts`** — `unreadReason(error)` keeps the **failure kind** and drops the
  message, `summariseUnread` counts it, `documentToolLine` renders the line both callers use.
- **`adoption/run.ts`** — `readRole` returns `{ok: true, records}` or `{ok: false, reason}`, and the
  plan's `document tool` line carries the counts.
- **`backfill/processes.ts`** — the same, one role, surfacing as `ProcessDurations.unread`.
- **The reason is threaded to the surfaces a person reads**: the backfill report's
  *declared-duration tier* line, the capacity-refresh result, and the `capacity refreshed` log line
  the CronJob emits — which is the only place a deployment sees this work.
- **Tests**: a new suite over the classifier, and one in each caller that an unbound store and a
  refused read now produce **different** lines, with a control that the failure's message never
  reaches the plan.

## Decisions taken

**The failure kind is what may be kept, and it is not a privacy compromise.** `errors.ts` already
rules it out loud: the closed set — `invalid_token`, `refused`, `refused`, `unavailable`,
`unbound_role` — is *"vendor vocabulary, fixed in an API reference, and identical for every workspace
on earth"*. It says why a read did not happen and nothing about where it was pointed. An error that
is not a `ConnectorError` is reported as `unknown` rather than guessed at, because the throw could
have come from anywhere on the path and inventing a vendor reason for a driver error would be worse
than admitting the read did not classify.

**Counts, never role keys — even though the keys would be safe.** `objectives_db` and the rest are
prisme's own vocabulary, not the workspace's, and the header already prints them for the stores that
*were* read. The row asked for a count of *why*, and the count is what carries the judgement: one
`unbound_role` is a store nobody bound, four of them is a seed file that was never loaded. Naming
each role would lengthen the line without changing that reading.

**Ordered by kind, not by scan order.** `3 refused, 1 unbound_role` sorts alphabetically, so two runs
over an unchanged world print the same line regardless of which role happened to be scanned first —
which matters here because the adoption scan's output is compared between runs (the idempotence test
does exactly that).

**A tier that is off by configuration reports no reason.** No client, or no `DOCTOOL_DURATION_PROPERTY`:
nothing failed, nobody asked, and a failure kind there would send a reader looking for a permission
problem that does not exist. `unread` is `undefined` in both cases, and a test pins it — the control
that keeps this change from being "print a reason always".

**One function renders the line, so the two callers cannot drift.** `documentToolLine` composes the
read counts and the unread counts, because the partial case — some roles bound, some not, which is
what a real instance looks like — is the one where a hand-written line quietly drops half the fact.

## What was not done

**Nothing was added to `docs/15-runtime.md` or `docs/16-sync.md`.** Neither specifies the text of a
report line, and neither was wrong about what it does specify. The line's shape is a user-interface
decision made in `apps/sync`, next to the reports that already live there.

**The metric surface is untouched.** This is about a report a person reads; the reconciler's
`prisme_sync_drift_objects` provenance is a separate row with a separate answer, and mixing an
observability contract into a diagnostics change is how the contract gets decided by accident.

## Follow-ups

None. Two things were considered and are *not* obligations: the KPI dashboard's Run-hours caveat (a
row of its own, raised with the owner in the same session), and the sync-metrics row's remaining
half, which stays 🟡 in the register where it already is.

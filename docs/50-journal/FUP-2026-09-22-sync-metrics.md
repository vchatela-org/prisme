# FUP · 2026-09-22 · The reconciler's own metrics were invisible in production

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes a gap nobody had recorded, found by trying to write the alert rules for a deployment rather
than by reading this repository. `docs/15-runtime.md` §5 specifies seven metrics and the alert each
one feeds, and calls `prisme_sync_drift_objects` *"the one that actually matters"*: *"persistent
non-zero drift means incremental sync is broken while appearing to work."* Two of the seven were not
observable in a deployment at all, and the reason was topological rather than a missing `set()`.

**The reconciler runs as a CronJob pod** — no Service, no ServiceMonitor, alive for seconds.
Prometheus never scrapes it. The CronJob sets both gauges correctly and they die with the process.
The API, which *is* scraped, exports the same two gauges from its registry and has no idea what the
last pass did.

Measured against the live cluster rather than reasoned about: `{__name__=~"prisme_.*"}` returned
**zero series**, and a deployed API served both gauges as a constant `0`, because prom-client renders
a registered, never-set, unlabelled `Gauge` as a sample with the value zero. Both of the natural
alert expressions were therefore wrong, in opposite directions:

| Expression | Behaviour against a zero |
|---|---|
| `time() - prisme_sync_last_success_timestamp > 1800` | True forever. An alert that fires permanently is worse than none — it teaches you to ignore the one time it means something |
| `min_over_time(prisme_sync_drift_objects[48h]) > 0` | `0 > 0`, false forever. A rule that cannot fire looks exactly like coverage |

The deployment side is closed separately and does not appear here: the cluster's staleness alert now
uses kube-state-metrics (`kube_cronjob_status_last_schedule_time` minus
`..._last_successful_time`), which needs no metric from prisme and no active-hours window. That
covers "passes are failing" and says nothing about drift, which is what this change is for.

## What was done

- **`packages/db/migrations/0009_sync_run_state.sql`** — one singleton row holding what the last pass
  did: `last_success_at`, `last_drift_objects`, `last_drift_at`, `last_drift_full`.
- **`apps/sync/src/state/run-state.ts`** — the writer and the reader in one file, because the table
  is a contract between two processes and a reader that drifts from its writer republishes a number
  that no longer means what the gauge's help text says it does.
- **`PassOutcome` on the `ReconcilerStore` port**, recorded from `run.ts` — in the library, not in an
  entrypoint, so the scheduled pass and the force-sync button both record. See *Decisions*.
- **`apps/api/src/sync/metrics.ts`** — the refresher, called from `/metrics` only.
- **`createMetrics` now leaves both sync gauges unset** rather than registered at zero, which is the
  half of the fix that applies to every consumer rather than only to the API.
- **Tests**: a unit suite over the refresher's degradation and its absent-is-not-zero behaviour, an
  integration suite over the round trip and the coalesce, and a unit suite over the gauge removal.

## Decisions taken

**PostgreSQL, not a Pushgateway.** ADR-0018 already guarantees that *all* prisme state is in
PostgreSQL, sync state included, so the pass writing its outcome and the long-lived API republishing
it needs no new infrastructure and no second copy of anything. A Pushgateway would have been a
second, unreconciled store for state that is already in the database — and the one thing a
Pushgateway is genuinely good at, surviving the death of the pushing process, is exactly what the
singleton row already does.

**The write goes in `run.ts`, not in `main.ts` beside the existing in-process gauges.** That is the
whole point of the two-entrypoints-one-library rule in `apps/sync/CLAUDE.md`: putting it in the CLI
would have left the API's force-sync path recording nothing, so the two paths would publish
different histories of the same reconciliations — the drift the module exists to prevent.

**Absent is not zero, and the difference is the defect.** `undefined` is load-bearing in
`SyncRunState`, and the gauges are `remove()`d rather than `set(0)`. "No pass has ever succeeded" and
"the last pass succeeded at the epoch" are different facts, and so are "nothing has measured drift"
and "drift is zero". Collapsing either into a number is what made both alerts wrong. Prometheus then
has *no data* rather than wrong data, an expression over it yields no result instead of a false one,
and `absent()` is available to alert on the difference deliberately.

**A refused pass still records its drift measurement.** With the write freeze on, every apply pass is
refused and none is a success — so `last_success_at` stays null and the drift column still advances,
because the incremental stream was compared against the full view either way and that comparison is
valid whether or not the plan was allowed to execute. This is what makes the read-only period
useful: drift is exactly the thing to watch before any write is enabled.

**`last_success_at` only moves forward.** `recordPassOutcome` uses
`coalesce(excluded.last_success_at, sync_run_state.last_success_at)`, so a refused or failed pass
cannot erase the memory of the last good one. A pass that succeeded at 10:00 and a refused pass at
10:15 must not publish 10:15 as the last success.

**`/metrics` degrades, it never fails.** The refresher bounds its read and swallows its own errors;
the handler guards it again. Both places carry the guarantee, and the reason is worth stating twice:
a metrics endpoint that returns 500 when the database is down blinds an operator at exactly the
moment they are looking, and losing two gauges is a far smaller loss than losing the heap, the
event-loop lag and every counter with them. On a failed read the gauges keep their last value rather
than being removed — removing them would turn a database blip into a gap in the series, which reads
as "the reconciler stopped", a false alarm about the wrong component.

**Not a history table.** The two metrics are latest-value facts, Prometheus keeps the history once
they are scrapeable, and a per-pass table at a fifteen-minute cadence is a retention policy nobody
asked for. Per-pass detail worth keeping already goes to `event_log`.

**Not three more columns on `sync_cursor`.** That table answers *where the incremental read got to*
— opaque tool state, written only on a pass allowed to write. This answers *how the pass went*, is
prisme's own bookkeeping, and is written by every apply pass including a refused one. Same table,
two lifecycles, and the next person to change one would have had to reason about the other.

## Surprises

**The defect was invisible from inside this repository, and every check passed.** Nothing in the test
suite could have caught it: the gauges *were* set, the code *was* correct, and the only thing wrong
was that the process doing the setting is never scraped. It took deploying prisme and trying to alert
on it. The general lesson is narrower than "add a test" — the observability contract in
`docs/15-runtime.md` §5 describes *what* to emit and never *who scrapes it*, so the two metrics whose
producer is short-lived had no way to be wrong on a developer's machine.

**A registered-but-unset prom-client `Gauge` is a sample at zero, not an absent series.** Worth
knowing beyond this change: it means any gauge added to this registry starts as a confident zero, and
a gauge whose zero is meaningful-looking will lie until something sets it. The other metrics here are
counters and histograms, where zero is the truth on a process that has not done the thing yet — which
is why this is applied to the two sync gauges specifically rather than to the registry.

**The first draft of the deployment's alert rule was wrong in a way that looked right.** Comparing
*now* against the last success is the obvious expression and pages every night, because the CronJob
is deliberately idle overnight; gating it on `hour()` does not fix it either, because PromQL's
`hour()` is UTC and the schedule is local, so a window wide enough for winter is an hour too wide in
summer. Comparing the last *schedule* against the last *success* needs neither a window nor a
timezone. Recorded here because it is the kind of thing that gets re-derived.

## Follow-ups

- **The deployment's drift alert should be restored once this lands.** Its `terraform/prisme.tf`
  currently carries one rule and a comment explaining that the drift rule was removed rather than
  repaired. With the API republishing the number, `min_over_time(prisme_sync_drift_objects[48h]) > 0`
  becomes correct as written — and with the gauges now unset rather than zero, it also stops being an
  expression that silently cannot fire.
- **`last_drift_full` is recorded and not yet used.** It is there because the spec alerts on drift
  *"above 0 on two consecutive daily full passes"*, so the provenance of the number is part of
  reading it, and the column would otherwise have to be added by whoever writes that rule properly.
  No reader uses it today.
- **`apps/sync/src/main.ts` still sets its own in-process gauges.** They are harmless — that process
  is never scraped — and removing them is a separate tidy-up that would touch the CLI's output
  contract. Left alone deliberately.

## Specs touched

None. `docs/15-runtime.md` §5 was already correct about *which* metrics to emit and *what to alert
on*; what it never said is who scrapes the emitter. Adding that would be an edit to a spec that is
not wrong, so it is recorded here instead — the deployment repository carries the operational
consequence in the file where the alert lives.

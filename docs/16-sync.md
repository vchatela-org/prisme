# 16 · Synchronization

prisme is a **reconciler**, not an event handler. Every run compares desired state against actual
state and converges. It is the controller pattern — `terraform plan` / `apply`, or a Kubernetes
controller — applied to two SaaS APIs.

---

## 1. Why level-triggered

An event-driven design reacts to change notifications: a webhook fires, a handler runs. It is
appealing because it is fast, and it fails in a way that is hard to notice.

| | Event-driven | Level-triggered |
|---|---|---|
| A missed event | **Drifts forever.** Nothing will ever revisit that object | Corrected on the next run |
| After a crash mid-write | Unknown state | Converges |
| Manual edit in an external tool | Invisible | Detected |
| API error | Lost unless a retry queue exists | Retried implicitly |
| Debugging | Replay a sequence of events | Read one plan |

Level-triggered systems are *self-healing by construction*. The cost is latency, and latency here is
minutes for a system whose decisions change weekly.

Webhooks may be added later as **hints only** — "run sooner" — never as the mechanism that carries
state. That keeps their failure mode harmless.

## 2. Cadence

| | Setting |
|---|---|
| Interval | Every **15 minutes** |
| Window | **07:00–23:00** local (`SYNC_WINDOW_START` / `_END`) |
| Overnight | Nothing runs |
| Full pass | Once daily, at the first run of the window |
| On demand | Force-sync button, any time |

Fifteen minutes is not a compromise — it is chosen because nothing in this system is urgent at a
finer resolution. Priorities change at review cadence, not continuously. The force-sync button
covers the one case where waiting is annoying: sitting in a review, having just changed something.

Not running overnight is a small privacy and cost measure, and it makes the daily full pass a
natural morning event.

### Incremental versus full

| | Incremental | Full |
|---|---|---|
| When | Every run | First run of the day, or if the last full pass is over 24h old |
| Task tool | Incremental sync token → changes only | Complete fetch |
| Document tool | Query by change timestamp ≥ watermark | Complete query |
| Detects | Changes since last run | **Drift** |

The full pass exists to answer a question the incremental path cannot: *did we miss something?* It
reports the count as `prisme_sync_drift_full_objects` — the series only a full pass writes, so it
stands still across the incremental passes in between, which is what makes a windowed minimum over
it mean *every* full pass in the window (see [`15-runtime.md`](15-runtime.md#metrics)). A non-zero
value on two consecutive full passes means incremental sync is broken while appearing healthy.

#### The capacity refresh rides the full pass

`capacity_week` — what the declared-against-observed comparison is drawn from — is materialised by
the **daily full pass**, over the trailing `CAPACITY_WINDOW_WEEKS` window. Until this, it was
materialised only by `prisme-sync backfill --from <date>`, a command a person runs, so the balance
read correctly on the day of the backfill and drifted from then on while its own screens still named
`capacity_week` as the source.

It rides the **full** pass rather than every pass for two reasons: the window is four weeks and a pass
runs every fifteen minutes, so daily is current with days to spare; and the refresh may read the
document tool for the declared-duration tier, which is a query worth making about once a day rather
than ninety-six times.

**It fetches the trailing window before it materialises.** Re-attributing `completion_history`
alone kept the weeks current with a history nothing added to between backfills, so the balance was
frozen at the last one. The refresh now reads `[min(cursor end, now − window), now)` from the task
tool in 28-day slices, through the backfill's own `recordSlice`: the same upsert, the same cursor,
and the completed task's title ([ADR-0032](20-decisions/0032-completed-task-titles-are-recorded.md)).
Starting at the earlier bound means a refresh that missed days never advances the cursor over a
stretch nothing read. A failed fetch is logged as `taskToolUnread` and the refresh still
materialises what is stored.

**Completions come from two records, merged** ([ADR-0040](20-decisions/0040-completions-are-read-from-the-activity-log.md)).
The completion history (`/api/v1/tasks/completed/by_completion_date`) lists a task once it is
checked. A recurring task never is, because completing it moves its date. So the **activity log**
(`/api/v1/activities`, completed and uncompleted items) is the source of which completions happened,
one per occurrence. The history stays for what the log does not carry: a one-off task's recorded
duration, its section, and the instant its row was first stored under. `readCompletions`
(`apps/sync/src/backfill/completions.ts`) is the one rule both the refresh and the backfill use:

- an un-completion takes back the completion before it;
- each history entry pairs with the log's latest completion of the same task, within a day, and the
  pair is the history's entry, unchanged;
- a log completion left over is stored on its own, located by the entry's project and section. With
  no section on the entry, it takes the open task's current section, but only while that task is
  still in the same project;
- a history entry left over stands.

Both records are read one day wider than each 28-day slice, so a pair is never split across two
slices. A re-run over rows the history-only reader stored adds the recurring occurrences and nothing
else. How far back the log reaches depends on the task tool's plan.

**It rewrites whole weeks, and both derived tables together.** `capacity_week` and
`capacity_completion` (one row per attributed completion, which is what the area screen lists) are
replaced in one transaction over the same weeks, so the list and the sums cannot disagree. The weeks
are loaded whole: the window starts mid-week on six days out of seven, and loading from that instant
used to rewrite the first week from the part of it after the instant.

It **writes prisme's own tables, reads the task tool's completions and, without a bound
document-tool store, reads no page at all** — so it runs with the write freeze on, which is the state
of every instance until the first outward write is authorised. It holds the read path only; no writer
is reachable from it. The chart has to work during the read-only phase; that is the phase it is for.

Three things it deliberately does not do. It does not re-materialise weeks outside the window —
what a lagging cursor makes it fetch from before the window is recorded, not re-counted — so a week
older than `CAPACITY_WINDOW_WEEKS` keeps the numbers the backfill gave it. It is **not** a `backfill` with
a narrow `from` — that would materialise everything the cursor covers, because `planResume` answers a
request narrower than the cursor with the union of the two. And it does not fail the pass: a capacity
write that failed is logged and the anchor reconciliation still reports its own outcome, because a
red CronJob over a derived table pages somebody about the wrong thing — while the staleness is
visible where it matters, in `observedThrough` on the balance view.

Filling history **older than the window** is still `prisme-sync backfill --from <date>`, still run
by a person, still with no default date. It is also the only thing that gives titles to completions
fetched before they were recorded, outside the trailing window — and only with a `--from` **earlier
than the cursor's start**, because a `--from` inside the covered range resumes at the cursor's end and
re-reads nothing. Any run re-materialises the whole covered range, so any run itemises the older weeks.

#### The write audit is pruned by the full pass

Every call to either tool is recorded in `external_write` by the writer that made it — the reconciler's
and the creation ledger's writers are decorated where they are constructed, in the CronJob and in
`POST /sync` alike, so no call site records anything by hand
([ADR-0031](20-decisions/0031-outward-writes-are-audited-and-pruned.md)). A record is written after
the call and **never fails it**: a write the tool accepted must still reach `last_applied` and its
binding, or the next pass would repeat it.

The last step of the daily full pass deletes records older than the retention window chosen in
Settings (default 90 days). Same terms as the capacity refresh: prisme's own table, so it runs with
the write freeze on; and a failure is logged, not a red pass — records then live a day longer than
the window says.

#### What the reconciler actually reads (W04)

The table above describes the *reads*. The planner's input is not one of them: **every pass reads
the task tool in full**, because the planner is level-triggered and compares full desired state
against full observed state (ADR-0009). A partial observation is not a smaller version of that
question — an anchor absent from an incremental response has not changed, while an anchor absent
from a full response has been deleted, and those demand opposite answers. One extra request against
a personal-sized workspace is not a cost worth trading correctness for, and quota is not a
constraint at this cadence anyway.

The incremental read keeps the job this section cares most about: it is **how drift is measured**.
An object the full view finds changed that the incremental stream never reported is an object the
incremental path would have missed, and the count of those is `prisme_sync_drift_objects`. It runs
only during `apply` — advancing a cursor is a side effect, and `plan` has none.

#### Objectives follow their window (ADR-0037)

Before anything else in the pass, and under the same lock, every open objective's status is
compared with its window (`apps/sync/src/objective-windows/`, the rule `objectiveWindowSteps` in
`@prisme/domain`): a draft whose period has started becomes `active`, an `active` one whose period
has not started becomes a `draft`, and one still open after its review window becomes `missed`. Each
change is a compare-and-set on the status read, written with a `status_changed` event that carries
the reason. It touches prisme's own table only, so it runs under the write freeze, and `plan` counts
without writing. It runs first so that the key results planned below belong to objectives in the
status their window gives them. A failure is logged and does not fail the pass.

#### An objective takes its own task (ADR-0038)

Next, still before the reconciler: an initiative whose task carries exactly an open objective's
title, in the same area, gives the task to that objective and is dropped with a reason
(`apps/sync/src/objective-tasks/`, the rule `objectiveTaskMatches`). It is one transaction per match,
and `plan` counts without writing. The reconciler then converges the objective's task (its deadline,
the `prisme:objective` label, the backlink) and places its key results' tasks beneath it, adopting a
subtask whose title is exactly the statement before it creates anything.

#### The objectives' pages (ADR-0034)

The same pass, after the task tool and under the same lock, reconciles one field into the document
tool: each linked objective page's **date column** is set to its objective's period
([`11-ownership.md`](11-ownership.md) §6). It is the same shape as the anchor half — a full read of
the objectives store, a pure planner (`apps/sync/src/objective-pages/`), `last_applied` keyed by the
page, and a hand edit restored and recorded as a conflict (§4) — and the same mode: `plan` prints it,
`apply` writes it. Nothing is read when no objective is linked or the store has no date column
chosen. A failed read is logged and does not fail the pass; a failed write does.

### Watermark handling

Change timestamps in the document tool are rounded down to the minute. Querying for
`>= last_run` therefore misses edits made in the same minute as the previous run.

Mitigation: **overlap the watermark by two minutes** and compare a content hash to suppress
no-op updates. Overlapping is cheap; missing an edit is invisible.

Rate limits are not a constraint at this cadence — a 15-minute interval consumes a small fraction of
either tool's allowance, and the full pass is the only expensive run.

---

## 3. plan / apply

```
$ prisme-sync plan

document tool   entities=NN   changed=N    watermark 2026-09-15T08:58Z (−2m overlap)
task tool       token …a91f   changed=N

  adopt    initiative   <redacted>     link to existing task           creates nothing
  update   anchor       <redacted>     priority high → highest
  update   subtree      <redacted>     3 subtasks inherit priority
  update   prisme       <redacted>     progress 40% → 60%
  review   initiative   <redacted>     anchor completed → status review
  conflict initiative   <redacted>     deadline edited externally; prisme owns it

Plan: 0 to create, 1 to adopt, 3 to update, 1 to review, 1 conflict.
Run `prisme-sync apply` to execute.
```

- `plan` has **no side effects** and is free to run at any time.
- `apply` re-plans immediately before executing; a stale plan is never applied.
- `apply` refuses a plan whose `create` count exceeds `SYNC_CREATE_THRESHOLD`
  ([`13-migration.md`](13-migration.md), Guard 3).
- Every `apply` pass records whether it was refused, and why, in `sync_run_state` (a kind —
  `create_threshold` or `write_freeze` — and the number of creates, never a title). `GET /sync`
  reports it as `lastRefusal`, and Focus and Settings show a refusal for creations (S8).
- `SYNC_WRITE_ENABLED=false` ships as the default, so a fresh deployment cannot write outward until
  someone decides it should.

> Output shown here is redacted: real titles are instance data. Actual console output shows them —
> it just must never be pasted into this repository ([`17-privacy.md`](17-privacy.md)).

### Planner shape

```ts
plan(desired, observed, lastApplied): Action[]
```

A **pure function**. All I/O lives in thin adapters either side. Everything difficult — ownership,
conflicts, inheritance, the no-duplicate guards — is decided in a function that can be exhaustively
tested against JSON fixtures, with no network and no clock.

Writes to the task tool carry a client-generated idempotency key, so a retry after a timeout cannot
apply the same change twice.

---

## 4. Conflicts

A **conflict** is a change, made in an external tool, to a field prisme owns
([`11-ownership.md`](11-ownership.md)).

**Default: prisme wins.** The next run restores prisme's value and records a ledger entry.
Predictable, no merge logic, no lost decisions.

### The intent channel

Blanket reversion would be hostile. There are days when the task tool on a phone is the only tool
available, and "your edit was silently undone" is how someone stops trusting a system.

So a defined set of external edits is reclassified as **requests**:

| Action in the task tool | prisme's response |
|---|---|
| Add the anchor label to any task | Create the initiative (status `inbox`) and link both — unless another entity, such as a key result, already holds the task |
| Complete an anchor | Move status to `review` for confirmation |
| Add a status-request label | Apply the status change, then **remove the label** |
| Edit `due`, subtasks, content, comments | Nothing — those fields are yours |

Removing the label after acting is what makes this a channel rather than a second source of truth:
the request is consumed, and the state lives in exactly one place afterwards.

Anything not on this list, touching a prisme-owned field, is a conflict.

### Making ownership visible

Every anchor's description ends with a managed-fields marker naming the fields prisme controls. The
information appears in the tool where someone would otherwise change them, at the moment they might.

A rule you can only discover by breaking it is a bad rule.

### The ledger

```sql
sync_conflict (
  entity_id, field, prisme_value, external_value,
  detected_at, resolution, actor
)
```

Surfaced as a UI badge, reviewed in the weekly review, counted by `prisme_sync_conflicts_total`.

**Conflicts are a design signal.** A field conflicting repeatedly is a field whose ownership is
wrong — the answer is to revisit [`11-ownership.md`](11-ownership.md) or add an intent-channel
action, not to keep reverting it every fifteen minutes.

---

## 5. Overwrite protection

prisme propagates priority from an anchor down to its subtasks. A priority set **by hand** must
survive that.

```
prisme may overwrite an externally-owned-but-prisme-propagated field
only if its current value equals the value prisme last wrote.
```

This requires `last_applied` — a per-entity, per-field record of what prisme most recently wrote.
Without it the only options are never propagating (useless) or overwriting deliberate edits
(infuriating). It is also what lets a plan distinguish "unchanged" from "changed back".

## 6. Failure handling

| Failure | Behaviour |
|---|---|
| External API `5xx` | Retry with exponential backoff and jitter, bounded; remaining work proceeds |
| Rate limited `429` | Honour `Retry-After`; counted in metrics |
| Invalid token | Stop immediately, alert. Do not retry — retrying a bad credential risks lockout |
| Partial apply | Actions are independent and idempotent; the next run completes the rest |
| Schema mismatch in an external tool | Fail the run with a clear message. **Never guess a mapping** |
| Database unavailable | Exit non-zero; the scheduler retries |
| Two runs overlapping | Prevented by advisory lock and `concurrencyPolicy: Forbid` |

Every run is safe to re-run. That property is what makes all of the above acceptable — a partially
applied plan is not a broken state, just an incomplete one.

## 7. Force sync

`POST /sync` on the API, behind a PostgreSQL advisory lock, running the **same reconciler library**
as the CronJob. The UI header shows last sync time, duration, action counts and outstanding
conflicts.

Calling the API rather than creating a Kubernetes Job means the web application needs no cluster
RBAC, and there is exactly one code path to reason about.

## 8. Testing

- **Planner unit tests** against JSON fixtures — the bulk of the coverage, no network, no clock.
- **Adversarial no-duplicate test**: an adopted entity must produce zero `create` actions.
- **Idempotence**: `plan` twice over unchanged state yields an empty second plan.
- **Conflict matrix**: every prisme-owned field, edited externally, produces a conflict — and every
  intent-channel action produces a request instead.
- **Overwrite protection**: a hand-set value survives; a prisme-set value is updated.
- **Contract tests** against recorded API responses, refreshed deliberately rather than live.
- **No test may call a real external API.** A test suite that depends on someone's real workspace is
  a test suite that fails for the wrong reasons and leaks instance data into fixtures.

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
reports `prisme_sync_drift_objects`, and a non-zero value on two consecutive days means incremental
sync is broken while appearing healthy.

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

It **writes prisme's own table and, without a bound document-tool store, reads no page at all** — so
it runs with the write freeze on, which is the state of every instance until the first outward write
is authorised. The chart has to work during the read-only phase; that is the phase it is for.

Three things it deliberately does not do. It does not touch history outside the window: a week older
than `CAPACITY_WINDOW_WEEKS` keeps the numbers the backfill gave it. It is **not** a `backfill` with
a narrow `from` — that would materialise everything the cursor covers, because `planResume` answers a
request narrower than the cursor with the union of the two. And it does not fail the pass: a capacity
write that failed is logged and the anchor reconciliation still reports its own outcome, because a
red CronJob over a derived table pages somebody about the wrong thing — while the staleness is
visible where it matters, in `observedThrough` on the balance view.

Filling history is still `prisme-sync backfill --from <date>`, still run by a person, still with no
default date. This keeps what that produced current; it does not replace it.

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
| Add the anchor label to any task | Create the initiative (status `inbox`) and link both |
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

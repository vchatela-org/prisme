# FUP · 2026-09-24 · The weeks keep themselves current

**Agent:** Claude · **Duration:** one session · **PR** [#76](https://github.com/vchatela-org/prisme/pull/76) · **Outcome:** complete

`capacity_week` was materialised only by `prisme-sync backfill --from <date>`, a command a person
runs. So the declared-against-observed comparison — the view that exists in no other tool, and the
reason prisme allocates before it ranks — read correctly on the day of the backfill and drifted from
then on, while the screens that drew it went on naming `capacity_week` as their source. The register
row put it plainly: *"the balance then reads stale weeks while naming them `capacity_week`."*

The **daily full pass** re-materialises the trailing window now.

## What was done

- **[`materialise()`](../../apps/sync/src/backfill/run.ts)** — the backfill's second phase, extracted
  and exported, taking an **explicit instant range**. `backfill` calls it with its own covered range;
  the refresh calls it with a window.
- **[`capacity-refresh.ts`](../../apps/sync/src/capacity-refresh.ts)** — the bounded refresh: the
  trailing `CAPACITY_WINDOW_WEEKS` weeks, ending at `now`.
- **The pass runs it after reconciling**, on a **full** pass in `apply` mode only, inside the same
  advisory lock.
- **6 unit tests**, one of which is the control that names the hazard this design avoids.
- **`docs/16-sync.md` §2** gains the subsection: when the refresh runs, what it deliberately does not
  do, and why it is not a `backfill` with a narrow `from`.

## Decisions taken

**The bound is an argument, not a `from` date — and that is the whole reason for the extraction.**
The obvious implementation is `backfill({ from: now - window })`, and it does not bound the work.
`planResume` answers a request narrower than the cursor with the **union** of the two, and phase two
materialises over that union — so a four-week request against a three-year cursor re-materialises
three years. A caller that wants a window needs a function that takes one. The test
*"is bounded by the window, not by how far the cursor reaches"* is that property, and the test beside
it asks the same narrow question of `backfill` and watches it materialise a week from four months
earlier. The two together are the argument, executable: if `planResume` ever changes, the control
goes red and says the refresh could become a thin wrapper.

**A full pass, not every pass.** A pass runs every fifteen minutes inside the window and the view
reads four weeks, so daily is current with days to spare. It also bounds the document-tool read this
can make — the declared-duration tier — to about once a day instead of ninety-six times, which
matters because that read is a query against somebody's workspace.

**It writes prisme's own table, and with no bound document-tool store it reads no page at all.** So
it runs with the write freeze on — every instance's state until the first outward write is
authorised. That is not a happy accident: the balance chart has to work during the read-only phase,
which is the phase the chart exists to inform. The `docClient` is passed when the instance has one,
and absent otherwise, exactly as `backfill` treats it.

**A failure logs and does not fail the pass.** The reconciler's job is anchors and it has done it by
then; a red CronJob over a derived table pages somebody about the wrong thing, and a Job that goes
red for a reason nobody can act on is how a real red gets ignored. The staleness is visible where it
matters instead: the balance view carries `observedSource` and `observedThrough`, so a reader is told
which record the numbers came from and how far its coverage reaches.

**Only history inside the window is rewritten.** A week older than the window keeps what the backfill
gave it. Re-deriving years on every pass is work nobody asked for, and the deep history only changes
when something structural does — a new `area_mapping` row, which is a human's deliberate act and a
re-run of the backfill.

**`main.ts` and not `reconcile()`.** The refresh is a step of the **scheduled pass**, sequenced beside
the creation-ledger drain that already lives there: prisme's own writes, inside the lock, in a
documented order. Putting it inside `reconcile` would have made it reachable from the API's
`POST /sync` too, and that endpoint has no document-tool client today — wiring one would be the
API's first read of that tool, which is a decision about an HTTP handler making a paged external
query, not a detail of this row. Recorded as a follow-up instead of smuggled in.

## Surprises

**The extraction was the easy part; the bound was not.** `materialise` is a cut-and-paste of a block
that was already self-contained. What would have been quietly wrong is the version that skipped the
extraction — and it would have looked *more* faithful to the row, because "a four-week `backfill`"
is exactly what the row's wording suggests. The measurement that killed it was `planResume`'s
`covers`, which is a union rather than a range, and which the first version of this plan read as
"the requested window". Recorded because the mistake is attractive.

**The pass's own log is the only place a deployment will see this work.** Nothing in CI runs a pass
against a task-tool API, and nothing local can either — see *Not done*. So the sentence an operator
reads in the CronJob's output is `capacity refreshed` with the week count, the attributed count and
whether the document tool was read. That line is the interface: an operator who cannot tell whether
the refresh ran has no way to distinguish it from a refresh that silently did nothing.

## Verified by running

`materialise` and `refreshCapacity` against the in-memory `BackfillStore` — a real implementation of
the port, with the primary key's refusal in place rather than a call counter.

| What was driven | Result |
|---|---|
| A four-week window, `now` a Monday | `from` is exactly 28 days earlier; the window's weeks are the four the balance view reads |
| The same store, with a cursor covering 2025-01 → 2026-10 and a completion in June | **only** the window's week is written; the June completion appears in no row |
| The same narrow request asked of `backfill` instead (the control) | it **does** materialise the June week — the hazard, executed |
| A pre-existing week row four months older than the window | present and byte-identical afterwards |
| An instance with no completions | zero weeks written, no failure, `documentToolRead: false` |
| `apps/sync` unit suite | **399 passed** (34 files) |
| `apps/sync` integration suite | **61 passed** (5 files) |

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The pass-level sequencing is **not** driven end to end | Local and CI cannot run a pass: the harness deliberately never calls the outward tools, so `apply` needs a real task-tool API. What is verified here is the unit level plus the compilation of the wiring. The deployment's read-only pass is where the `capacity refreshed` line is read back — the runbook's §6b | the human, at the deployment |
| `POST /sync` does not refresh capacity | Deliberate, above. A forced full sync from the UI updates anchors and leaves the chart to the next scheduled full pass | a later change, if somebody wants the button to do it |
| The refresh's own count is not a metric | It logs. A gauge for "weeks refreshed" would make a refresh that stopped running visible to an alert rather than to somebody reading a log | a later follow-up, with the deployment's alerts |

## Not done

- **No change to `reconcile()`**, and therefore none to `POST /sync`. Reasoned above.
- **No new command.** `prisme-sync backfill --from <date>` still fills history; the refresh is not a
  CLI verb, because the thing it exists for is running without anybody typing it.
- **No deployment change.** The CronJob already runs `apply`; the pass found a step to add.
- **No ADR.** The refresh is an implementation of `docs/16-sync.md`'s cadence for a table that spec
  already owns; nothing about the model moves.

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `typecheck` | local + CI | local clean |
| `lint` | local (per tree) + CI | clean on the changed files |
| `test` | local + CI | `apps/sync` 399 unit and 61 integration, with both test-database URLs set; CI runs the whole repository |
| `build` | local + CI | `pnpm --filter @prisme/sync run build` clean |
| `privacy deny-list` | local + CI | local clean |
| every other required check | CI | see the rollup on the pull request |

## Privacy

No instance data. The tests use invented task ids, invented projects and invented durations, and the
dates in them are invented too; the store is an in-memory fake. Nothing here names a real area,
project, task, identifier, hostname or workspace, and no plan output — which carries real titles —
is reproduced anywhere. The one identifier-shaped string in the new code is `p-alpha`, which is the
fake store's own fixture. Deny-list and secret scans are green.

## Specs touched

- [`docs/16-sync.md`](../16-sync.md) §2 — the cadence section gains *The capacity refresh rides the
  full pass*: when it runs, the three things it does not do, and why it is not a narrow `backfill`.
- [`docs/15-runtime.md`](../15-runtime.md) — **not edited**: `CAPACITY_WINDOW_WEEKS` already
  documents the window as the rolling one the balance view reads, and this is a second reader of it.
- [`apps/sync/CLAUDE.md`](../../apps/sync/CLAUDE.md) — the **Shape** block names `capacity-refresh.ts`
  and says which step of the pass it is.
- [`STATUS.md`](../../STATUS.md) — the "nothing schedules the backfill" row closes.
- [`docs/50-journal/INDEX.md`](INDEX.md) — this entry's row.

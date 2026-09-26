# FUP · 2026-09-26 · §7 rehearsed, and the duration tier needs two things, not one

**Agent:** Claude · **Duration:** one session · **PR** — · **Outcome:** complete

The gate line that had nothing behind it now has a rehearsal behind it. Running it produced two
corrections: the rehearsal's own figure is empty on the very instance it gates, and
`DOCTOOL_DURATION_PROPERTY` — recorded twice as *"the whole of 100% of these minutes are estimated"* —
is a **precondition of** that share rather than the whole of it. **No real value appears in this
entry**: no area key, weight, external id, property name or title. The numbers are counts.

## The gap this closes

[`STATUS.md`](../../STATUS.md)'s *Before the first outward write* section carried
**"a restore rehearsed at least once, not merely scheduled"** with nothing behind it: no run, no
readout, nothing to read — where the backup CronJob beside it carries three completed runs.
[ADR-0022](../20-decisions/0022-backups-belong-to-the-deployment-repository.md) makes this a human
checklist item: prisme does not check it, refuses nothing on its account, and has no way to know. So
the useful contribution is **evidence for a human to read**, not a tick.

## §7, run against the live instance

The procedure is the deployment repository's, and it ran exactly as written — a throwaway database on
the same server, never the live one, dropped at the end:

- **The dump.** Five retained; the newest is the one the scheduled 01:30 pass produced, and the
  backup job's own structural check (`pg_restore --list`, a real read of the trailing TOC rather than
  a magic-number test) had already passed it.
- **The rehearsal.** `pg_restore --no-owner` into a throwaway database, the table list read back, the
  test database dropped. **35 tables restored**, and the Job exited `0`.

**Then a second pass to read the counts, because the runbook's Job prints one.** That is not a
criticism of the procedure — it is what "a dump that has never been restored is a hypothesis" turns
into when the hypothesis is checked. The restore carried the instance's judgement data back intact:
**eleven tables non-empty**, including the materialised capacity weeks, the area mappings, the year
weights, the role bindings and the completion history.

## The one figure §7 asserts is `0` on this instance

The runbook's Job prints exactly one number and names it the one that matters — `entity_link`, "the
mapping from prisme entities to external objects", the thing "a restore that brings back the schema
and loses" has not restored. It is **`0` here**, and legitimately: no adoption decision has been
made, so nothing is linked yet. Measured on the live database the same session: `entity_link` 0,
`ritual` 0, `entity_external_ref` 0, and `objective` / `project` / `takeaway` / `initiative` all 0.

So on an instance that has not worked its queue, the rehearsal's single readout cannot distinguish
*restored correctly* from *restored nothing*. The check is a demonstration rather than an assertion
by design, and the demonstration happens to print the one column that is empty.

**The ordering consequence is the part worth keeping.** A rehearsal that could actually lose
`entity_link` must come *after* the adoption queue is worked, because until then the table is empty.
[`13-migration.md`](../13-migration.md#5-sequence) already allows the gate to land "at any time up to
here" and the runbook already says to re-run it once there is real data — so the ordering was
understood; what was missing was the measurement that says **the second run is the one that counts**,
and that the instance is still in the first-run state even though it is fully configured.

## `DOCTOOL_DURATION_PROPERTY` is necessary and not sufficient

The item has been carried in two journal entries and in `STATUS.md` as *"the whole of 100% of these
minutes are estimated"*. It is not the whole of it.

`apps/sync/src/backfill/processes.ts` reads the named property off a process page, but it does not
map pages to completions directly: it builds `page → minutes`, then **joins that to `ritual`**, using
`ritual.external_page_id` for the page and `entity_external_ref` for the recurring task the ritual
binds. Only that join produces `byTask`, and `byTask.size` is what the report prints as
`declaredDurationsKnown`. **Both tables are empty on the instance** (0 rows each, measured above), so
setting the variable would flip `documentToolRead` to `true` and still report **zero declared
durations**. The two preconditions are independent, and only one of them is a variable.

**And the second precondition has no loader.** `prisme-sync` has no `rituals` subcommand
(`main.ts` routes `apply`, `plan`, `adopt`, `backfill`, `create`, `bindings`, `areas`), `seed/` has no
ritual file and neither does `seed.example/`, and the only door is `POST /rituals` behind
`write:ritual` — with **no UI caller**: `apps/web` reads `/rituals` in one place and creates none.
A live instance's rituals can therefore only be set by hand-written calls, which is exactly the shape
[#74](https://github.com/vchatela-org/prisme/pull/74) closed for areas, weights and mappings.
Recorded as a register row rather than fixed here: a loader needs a seed format, and choosing one is
a decision rather than a chore.

This is not only the declared-duration tier's problem. Ritual adherence — W13's other output — is
measured *over rituals*, so with none defined it has nothing to measure either.

## A surprise worth carrying

Writing the count pass meant copying the runbook's Job and hand-editing it, and the copy dropped its
`volumeMounts` and `volumes` — so `/backup` was an ordinary empty directory inside that container.
The first line of output said so and the Job went red on its last line, so nothing was concealed.
What it shows is that **the rehearsal is only as loud as its own shell**: this variant redirected
`pg_restore`'s stderr to keep collecting output, and with that redirect in place it would have
carried on against an empty database and printed a table list that looks exactly like a restore with
no rows in it. The runbook's own Job is the loud one — `set -e` intact, so an empty `DUMP` makes
`pg_restore` fail. The reason it earns a line is that it is the finding above reached from the other
side: **a demonstration of nothing looks like a quiet success**, and the shape that makes it visible
is a count that cannot be zero on a real restore.

## What I did not do

- **Did not tick the gate line.** It is a human's, per ADR-0022, and the meaningful version of the
  rehearsal is still ahead of it. The line now carries the evidence and stays unticked, as the backup
  row beside it does.
- **Did not set `DOCTOOL_DURATION_PROPERTY`.** Naming the property is a workspace decision, and on
  its own it would change a log line without changing a number.
- **Did not build a ritual loader.** It needs a seed format decision; the gap is registered instead.
- **Did not work the adoption queue.** It is the owner's step, and it is now the keystone one: it is
  what makes `entity_link` non-zero, which is what makes the restore rehearsal mean anything.
- **Did not improve the runbook's Job.** Printing the counts of the tables that currently hold
  judgement data beside `entity_link` would make the readout informative before the queue is worked —
  but the file is the deployment repository's, so it is recorded here as a follow-up rather than
  changed from this tree.

## Follow-ups

- **The deployment repository's §7 could print more than `entity_link`** — a per-table row count
  after the restore makes the rehearsal readable on an instance that has not adopted anything yet.
  Owner: the deployment repository.
- **Rituals have no loader** (new register row): no subcommand, no seed file, no UI caller. It gates
  the declared-duration tier and ritual adherence at once.
- **The queue still has to be worked before the gate closes.** Unchanged by this entry, and now
  known to be upstream of the rehearsal rather than parallel to it.

## Specs touched

- [`STATUS.md`](../../STATUS.md) — the restore line gains its evidence and a note that the meaningful
  rehearsal follows the queue; two new follow-up rows (the unloadable rituals, and §7's readout).
- [`docs/15-runtime.md`](../15-runtime.md) — `DOCTOOL_DURATION_PROPERTY` said only that unset leaves
  the order two-tier; it now says what the tier *also* needs.
- **No code and no migration.** Everything this session changed is a cluster Job, a throwaway
  database and this repository's own records.

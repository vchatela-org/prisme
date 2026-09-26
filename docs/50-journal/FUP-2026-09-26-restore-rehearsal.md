# FUP · 2026-09-26 · §7 rehearsed, the duration tier needs two things, and the queue does not refresh itself

**Agent:** Claude · **Duration:** one session · **PR** [#91](https://github.com/vchatela-org/prisme/pull/91) · **Outcome:** complete

The gate line that had nothing behind it now has a rehearsal behind it. Running it produced three
corrections: the rehearsal's own figure is empty on the very instance it gates,
`DOCTOOL_DURATION_PROPERTY` — recorded twice as *"the whole of 100% of these minutes are estimated"* —
is a **precondition of** that share rather than the whole of it, and the adoption queue is a single
scan from before any area existed, refreshed by a command that does not run on its own.
**No real value appears in this entry**: no area key, weight, external id, property name or title.
The numbers are counts.

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

## The adoption queue does not refresh itself, and it is unlabelled

The queue is the owner's step, and measuring it changed what that step is. The live database's 85
`adoption_candidate` rows all carry **one** `scanned_at` — a single scan, on **2026-09-22**, three
days before §6a–§6c put any area in the database. Every row's `area_key` is therefore **null**, and
null on that column has a meaning of its own: the migration's own comment says it is *"null when no
`area_mapping` covers its location — which is itself a finding, not an error"*. Here it is not that
finding; it is the older one — there was no area to map to. All 85 also carry no identity proposal
(`match_rule` null), so they are the manual remainder in full.

**And nothing refreshes them.** The scan runs under `prisme-sync adopt --plan` and nowhere else: the
daily pass is `apply`, and `main.ts` reaches the scan only on the `adopt` command. So the queue is not
stale because a schedule stopped — it is stale because its only writer is a command nobody has run
since 2026-09-22.

**Which reorders the owner's next step.** Working the queue as it stands means deciding 85 rows with
no area attribution, and `area_key` is what the queue exists to group by: its comment says the
attribution is there *"so the queue can be worked one area at a time"*. `prisme-sync adopt --plan` is
read-only outward, is **already one of the gate lines**, and repopulates the queue from the world as
it is now that the mappings exist — so it refreshes the queue *and* produces the `Would create: 0`
readout that line asks for. It is the first action, not the last.

**It was not run here.** The gate says a human runs it and reads it, and its output carries real
titles by construction (`apps/sync/CLAUDE.md`), so running it would neither satisfy that line nor be
mine to satisfy.

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
- **Did not work the adoption queue, and did not re-scan it.** Both are the owner's, and the re-scan
  is a command the gate says a human runs and reads. What this session established is that the
  re-scan comes **first** — the queue is one scan from before any area existed.
- **Did not reconcile the queue's count with the read-path entry's.** That entry recorded 94
  candidates; the live table holds 85, and its single `scanned_at` is 2026-09-22 — so the run that
  produced 94 did not write this database. `STATUS.md` records that run as *"run on 2026-09-24,
  locally, against the live tools"*, which is where it went. Worth knowing before the two numbers are
  read as a backlog that shrank.
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
- **`prisme-sync adopt --plan` is the first action of the gate, not the last.** It refreshes the queue
  (its only writer), labels it with areas now that the mappings exist, and produces the `Would create:
  0` readout its own gate line asks for — all read-only outward. Owner: the human who will read it.
- **The queue still has to be worked before the gate closes.** Unchanged by this entry, and now known
  to be upstream of the rehearsal rather than parallel to it.

## Specs touched

- [`STATUS.md`](../../STATUS.md) — the restore line gains its evidence and a note that the meaningful
  rehearsal follows the queue; the adoption-queue line gains the measurement that says a re-scan comes
  first; two new follow-up rows (the unloadable rituals, and §7's readout).
- [`docs/15-runtime.md`](../15-runtime.md) — `DOCTOOL_DURATION_PROPERTY` said only that unset leaves
  the order two-tier; it now says what the tier *also* needs.
- **No code and no migration.** Everything this session changed is a cluster Job, a throwaway
  database and this repository's own records.

---

## Addendum — 2026-09-26 · the queue re-scanned, and an area key cannot be renamed

The entry above recorded the queue as stale and unlabelled and left the re-scan to its owner; it was
run. Two things changed, and the third changed what *settle the keys* means. **No real value appears
here either** — the numbers are counts.

### The queue is 94, not 85, and twelve candidates now carry an area

`adopt --plan`, run from the deployment repository's own CronJob spec with the argument added, and its
report deliberately **not read** — it prints real titles by construction, so the counts below come
from the database instead. Nine candidates appeared that the earlier scan did not have, and they are
all `task`-kind: the scan that produced 85 was missing the **task** tool's half, not the document
tool's. It also confirms that the 2026-09-24 local run's 94 was not a different world — the same scan
over the same instance produces the same number, which is the sort of thing worth knowing before two
figures are read as a backlog that moved.

Twelve candidates now carry an area, across six areas. Before, none did, and for a reason that had
nothing to do with the mappings.

### And 79 of the remaining 82 cannot carry one at all

The attribution is not evenly missing:

| Candidate kind | With an area | Without |
|---|---|---|
| `page` (document tool) | 0 | 79 |
| `project` (task tool) | 3 | 3 |
| `task` (task tool) | 9 | 0 |

`area_mapping`'s only location columns are `external_project_id` and `external_section_id` — both
task-tool vocabulary — so a document-tool page has no location that a mapping can name, and none of
the 79 can be labelled by area at all. The queue's own comment says the attribution is there *"so the
queue can be worked one area at a time"*; measured, that holds for the fifteen task-tool candidates
and not for the 79 pages, which are 84% of the queue. Whether that is intended is a question about the
mapping vocabulary rather than about this instance, so it is **recorded and not changed** — inventing
a mapping shape to have something to do would be the wrong fix.

### An area key cannot be renamed, so the keys are settled at the reset or not at all

The keys item turned out to have a constraint that decides it. `saveAreas` matches a stored area by
`key` and updates `name`, `kind`, `active`, `external_page_id` and the run-lane budget — **never the
key**. A key is settled the moment anything references it, and on this instance things already do: the
mappings and the materialised capacity weeks. So the "proposal" in the gitignored seed file is no
longer a proposal *for this instance* — changing a key now is hand-written SQL, not a re-run of
`prisme-sync areas`.

That would close the item with a shrug, except for one thing already on the record: the 2026-09-25
session recorded that **the instance is expected to be reset before real data is loaded**. The reset
is therefore when the keys are chosen, and the only moment they are cheap. Both facts are now in the
seed file's own `_open_questions`, where the person deciding will read them — which is the right home
for instance data that must not enter this repository.

**The reset itself was on no dashboard.** It lived in one journal entry's follow-up list and nowhere
else, which is the shape `STATUS.md`'s own rule calls an *obligation* rather than a note. It is a
register row now, because three open items take their timing from it: the keys, the rehearsal's
meaningful run, and the queue's first real work.

### Specs touched, addendum

- [`STATUS.md`](../../STATUS.md) — the adoption-queue line corrected in place (it said the queue was
  stale; it is not any more), the `adopt --plan` line gains the evidence that the scan has been run,
  and a new row for the planned reset.
- `seed/areas.json` (gitignored) — `_open_questions` gains the two facts that decide the keys item.
- **No code and no migration.**

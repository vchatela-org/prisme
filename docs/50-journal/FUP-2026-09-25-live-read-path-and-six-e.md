# FUP · 2026-09-25 · §6e applied, and the read path re-run against the live tools

**Agent:** Claude · **Duration:** one session · **PR** [#90](https://github.com/vchatela-org/prisme/pull/90) · **Outcome:** complete

The instance's last piece of configuration applied, the read path re-run end to end with the live
credentials, and the screens opened on the data it produced. **No real value appears in this entry** —
not an area key, a weight, an external id or a title; the numbers are counts, and the instance's own
rows stay in the gitignored `seed/` and in the terminal.

## The gap this closes

[`STATUS.md`](../../STATUS.md)'s register row was 🟡 on one thing and one thing only: **§6e was
written and not applied**, so an instance configured completely by §6a–6c still painted several areas
in one hue. Everything else on that row had already been done — the steps written, the pin moved, the
seed loaded, the run read back.

## §6e, applied

The value went to the web tier's Vault entry, and three things were checked rather than assumed:

1. **The map is the screen's line, not a composed one.** §6e says *take it from the screen* precisely
   because a hand-written map is how two areas land on one slot a second time. The screen was not
   reachable for this session, so the same **pure function the screen calls** (`proposePins`, in
   `apps/web/src/lib/area-pin-proposal.ts`) was run over the instance's own area keys, read from the
   file §6a loaded. That is the screen's answer, computed the screen's way — not a map reasoned out by
   hand.
2. **The value landed and nothing else was lost.** The entry's other keys are still present — a
   `patch` that replaced the map rather than merging into it would have been the quiet failure.
3. **The Kubernetes Secret carried it, and the tier rolled to it.** Compared by hash, never printed:
   the value VSO wrote into the web tier's environment is byte-identical to the Vault value. The
   rollout followed on VSO's own hourly horizon — **the Deployment's generation moved and a new
   ReplicaSet stood up a pod reading that secret** — rather than a hurried `kubectl patch`, which §6e
   names as the thing that blocks the next apply. The wait is the step working, not the step stuck.

**Taken from the screen and re-derived, and they agree byte for byte.** Running the proposal
function locally against the same keys produced exactly the line the Areas screen prints, which is
the check that the value in Vault is the value the screen would have handed an operator.

## The read path, re-run with the live credentials

P1 was run on 2026-09-24; this repeats it against the same instance with the configuration now
complete, and the point is that **every step produced a count rather than a reason**:

- **The task tool read fully** — one full pass, objects counted, and `plan` answering **`0 to create,
  0 to adopt, 0 to update, 0 to review, 0 conflicts`**. ADR-0010 guard 3 is answered by measurement
  again, on an instance whose write freeze is on: *"apply would change nothing outward"*.
- **The document tool is read** — all five bound roles returned counts, which is what the register's
  *"not read at all"* row was about before #39 and the bindings.
- **The adoption scan queued 94 candidates, 0 certain, 94 needing a person**, with link coverage
  reported and **`Would create: 0`** — the guarantee that adopting links and never creates, asserted
  on the live world rather than in a test.
- **The backfill attributed the window** and reported its remainder as unattributable, which is the
  shape the report exists to produce.

## The screens, on real data

Driven in a real browser against the local tier, seeded from the live tools and nothing else:

- **`/areas` shows area *names*, never keys** — the defect W11 and W15 each recorded, absent here on
  a real instance — and the declared-against-observed balance is drawn from real attribution: one
  area over-served beyond the end of the scale at a balance factor of the clamp's floor, another
  starved. **This is the view that exists in no other tool**, and it is the first time it has been
  drawn from an instance's real work.
- **`/kpi`** reports its completions and its deliberate absences, including the cycle-time paragraph
  saying why the number is not available rather than inventing one.
- **`/review/year`** names the record its minutes are read from, which is #78's fix visible on real
  data, and says plainly that **100% of those minutes are estimated rather than recorded** — the
  two-tier duration order, whose cause is the one unset variable below.
- **The console carries no CSP violation**, only the favicon 404 the earlier runs also saw.
- **`/adoption`** lists the queue with the reason each candidate is there and the two decisions a
  person makes. **No candidate was decided** — that is the owner's step, and deciding it here would be
  deciding with the cleanup not yet done.

The colour check was made both ways, which is the only way it means anything: with no pins the screen
**reports the collision and prints the line**, and with the pins applied **the notice is gone**.

## The backup is real

The register's outward-write gate has *"Backup CronJob deployed"* as its first line, and it had never
been evidenced. It is: the CronJob exists, is scheduled daily in the instance's timezone, and has
**three completed runs** on the cluster. Nothing here ticks that box — the file says a human owns each
line, and it is right to.

## Surprises

**The harness driver fails three checks on purpose when it is not looking at fixtures.** Run with
`--no-seed` — which is what keeps an instance's real data — `drive.mjs` still asserts the *fixture*
initiative is on `/`, `/backlog` and `/api/v1/focus`, so those three fail and everything else passes,
including every authentication negative case. The failures are the driver telling the truth about what
it is pointed at, and they are worth reading as that rather than as a regression.

**The tokens in the local env files were harness values, not the deployment's.** The first live run
stopped at *"the credential was rejected"* **after** the whole database path had succeeded, which is
exactly the shape that reads as a code defect. They are ~17–18 characters; the live pair is 40 and
50. Refreshing them from the vault is the fix, and the failure is worth recognising again.

**A fresh dev database has no grants for the application role.** Recreating `prisme` and migrating
from scratch left `permission denied for table …` for `prisme_app`, because the migrations ran as a
different role than the one `dev-roles.sql` expects and the default privileges never fired. The four
grant statements are the repair, and `docker-compose` only runs that file on a database's *first*
start — so a hand-recreated database is always missing them.

## Follow-ups

- **`DOCTOOL_DURATION_PROPERTY` remains unset**, and it is the whole of *"100% of these minutes are
  estimated"* on every minutes chart. A naming decision in a workspace, not a code change.
- **The deployment's drift alert is still the removed one.** Re-pointing it at
  `prisme_sync_drift_full_objects` needs a release that contains the gauge — it is built and green,
  and not yet tagged.
- **§7, the restore rehearsal, is still unpassed**, and the adoption queue is still the owner's to
  work. Both are the gate before the first outward write, and nothing here touches the freeze; it
  ships off and stays off.
- **The instance is expected to be reset before real data is loaded**, so nothing here needs undoing.

## Specs touched

- [`STATUS.md`](../../STATUS.md) — the deployment-runbook row, corrected in place.
- **No spec and no code.** Everything this session changed is configuration on a live instance or data
  in a local database; the repository's own files are untouched apart from this entry and that row.

# FUP · 2026-09-28 · An open objective's period moves, and its page's dates follow

**Asked:** the owner adopted an objective from the objectives store and asked how to change its
date: in Notion, in prisme, or neither. The answer was *neither*. They asked for the period to be
editable in prisme and for the change to reach Notion and Todoist. They chose the bound themselves:
an objective can move **while it is open** (draft or active).

## What was there

- **The period was fixed on purpose.** `PATCH /objectives/:id` took a title, a status and a page
  link. The route, the Objectives screen and its server actions said why: *an objective that moves
  between months is a different objective*. The rule lived in code and copy from W05 and W11, and in
  no ADR or spec. The first answer to the owner missed it, and it was put in front of them before
  anything was built.
- **Notion's dates are read once**, at adoption. Nothing reads them again, so an edit there changes
  nothing and says nothing.
- **Nothing writes an objective outward.** §6 of the ownership matrix marks the period `P →`, but no
  code writes it. **Todoist holds nothing that carries an objective's period.** The reconciler writes
  initiative anchors only, and key results have no anchors yet. So the Todoist half of the request
  has nothing to write, which was said rather than invented.
- **Notion editing was already allowed.** The threat model grants `objectives_db` read/write for
  fields prisme owns. The rule that *prisme never edits a page* covers only the create-only page
  stores. No Accepted ADR stood in the way.

## What was done

- **[ADR-0034](../20-decisions/0034-an-open-objective-moves-and-its-page-follows.md)**, accepted on
  the owner's decision. It adds a row to [`11-ownership.md`](../11-ownership.md) §6 for the page's
  date column.
- **The domain** gains `isObjectiveOpen`, `periodMatchesType` and `objectiveDatesOf`, the exact
  inverse of adoption's `objectivePeriodOf`. The audit gains `update_page` and the event log gains
  `period_changed` (migration **0018**).
- **The API.**
  - `PATCH /objectives/:id` takes `type` and `period`, either alone.
  - A closed objective is refused with `409`, and a pair that disagrees with `422`.
  - Each real move is a `period_changed` event carrying the before, the after and the actor.
- **The connectors.**
  - A third capability, *edit*, is held by `objectives_db` alone.
  - `setEntryDate` reads the entry first. It refuses, sending nothing, unless the entry's parent is
    the bound data source, it is not in the trash, and the property is a date. It then `PATCH`es
    that one property, addressed by its id.
  - `DocumentEntryWriter` fixes the role, is frozen under the write freeze, and is audited.
- **The sync pass.**
  - After the task tool, under the same lock, it reads the whole objectives store. A pure planner
    (`objective-pages/plan.ts`, now under the planner-purity lint rule) compares each linked page's
    column with its objective's period.
  - A difference always goes prisme's way. `last_applied` (`objective_page`, keyed by the page)
    decides whether it was an update or a hand edit, and a hand edit is restored and recorded as a
    `prisme_wins` conflict.
  - Five cases write nothing and are reported: the page is not in the store, it is in the trash, it
    has no such column, two objectives share one page, or a period is not written the way its type
    says.
  - The CronJob and `POST /sync` both run it.
- **The screen.** An open objective's page has a collapsed **Move period** control. It says the move
  is kept in the objective's history, and, for a linked objective, that the Notion dates follow and
  a hand edit there is put back.
- **Tests:**
  - domain units for the round trip and the leap month;
  - connector tests over a recorded transport, one for each refusal, plus proof that the column's
    name is never sent or put in an error;
  - planner units for every verdict, determinism and convergence;
  - runner tests for plan, apply, freeze, a failed write, a rejected token and a driver error's text;
  - a store integration test;
  - API integration tests for a move, a no-op, the three closed statuses, a mismatched pair, and the
    area staying fixed.

## Decisions taken

- **The open-status bound is the owner's.** *Only before the period starts* was offered and
  recommended; they chose open-status, which also corrects a period set wrongly on an objective
  already running.
- **Write every pass, not only the daily one.** A move then reaches the page within fifteen minutes.
  The cost is one query of a small store, and nothing is read when nothing is linked.
- **Key `last_applied` by the page, not the objective.** It is what prisme wrote *into that page*,
  so re-linking an objective to another page does not make the new page's dates look like a hand
  edit.
- **Refuse a page shared by two objectives**, rather than let two periods overwrite each other on
  every pass.
- **Record a hand edit as `prisme_wins`, not `unresolved`.** That is the policy's default, and the
  review's resolve step links an unresolved conflict to an *initiative* screen, which would be wrong
  here.
- **A read failure does not fail the pass, and a write failure does** — the creation ledger's
  judgement.

## Surprises

- **The first answer said making the period editable broke no rule. It broke a deliberate one.** It
  broke no *ownership* rule, and no ADR, but the product rule was sitting in the route description.
  Grepping for the behaviour's own wording, not only the ADRs, is what found it.
- **The first reversal procedure written for migration 0018 would have failed.** It deleted the
  `period_changed` rows and narrowed `event_log`'s CHECK again. Rehearsed on empty tables, it
  passed. Rehearsed with a move recorded, the append-only trigger refused the `DELETE`, which is
  that trigger doing its job. The reversal now leaves `event_log` as it is and says what that costs
  an older image. **A reversal has to be rehearsed with rows the migration makes possible**, not
  only on the schema.
- **`POST /sync` never ran the creation-ledger drain.** So the two entrypoints already differed
  before this. The objective step was added to both, to keep this feature from widening the gap.

## Follow-ups

- **After this rolls out:** run `prisme-sync plan`, or *Force sync*, and read the objective-pages
  lines before the first `apply` pass acts on them. Any linked page whose dates differ from its
  objective's period is rewritten, including one linked by hand.
- **Writing an objective's title, status and area outward** stays P7's, each with its own
  `last_applied` field.
- **A way to accept Notion's date** when the two disagree is not built. The review's conflict step
  assumes an initiative.

## Specs touched

- [ADR-0034](../20-decisions/0034-an-open-objective-moves-and-its-page-follows.md), and its row in
  the ADR index.
- [`11-ownership.md`](../11-ownership.md) §6, [`14-threat-model.md`](../14-threat-model.md) §5,
  [`16-sync.md`](../16-sync.md) §2, [`10-model.md`](../10-model.md) §7, and
  [`18-user-guide.md`](../18-user-guide.md) §5 and §6.

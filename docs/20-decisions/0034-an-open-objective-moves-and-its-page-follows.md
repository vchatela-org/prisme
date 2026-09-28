# ADR-0034 · Move an open objective's period in prisme, and write it to its page's date column

**Status:** Accepted · 2026-09-28 · decided by the owner, 2026-09-28

## Context

The owner adopted an objective from the objectives store — one set for a future year — and asked how
to change its date: in Notion, in prisme, or neither. The answer, checked against the code, was
**neither**:

1. **The period was fixed at authoring.** `PATCH /objectives/:id` took a title, a status and a page
   link, nothing else. The route's description, the Objectives screen and its server actions all
   said why: *an objective that moves between months is a different objective, and letting one
   move would make attainment history meaningless*. That rule was written by W05 and W11, in code
   and in copy. No ADR and no spec made it.
2. **Notion's dates are read once.** An adopted objective gets its `type` and `period` from its
   page's date column at adoption (ADR-0033, amended 2026-09-28), and after that the period is
   prisme's. Nothing reads the page again, so an edit made there changes nothing in prisme, and
   nothing says so.
3. **Nothing writes an objective outward.** [`11-ownership.md`](../11-ownership.md) §6 marks
   `period` **P →**, but no code writes any objective field to either tool. The task tool holds
   nothing that carries an objective's period at all. The reconciler writes only initiative
   anchors, and key results have no anchors yet.

So a date set wrongly, or a plan that moved, could not be corrected anywhere.

What constrains the answer:

- **The period's owner does not move** (CLAUDE.md, rule 2). §6 says prisme, and the year-scoped
  weights and the Year Review key on it.
- **[`14-threat-model.md`](../14-threat-model.md) §5 already grants `objectives_db` read/write**:
  *"prisme owns specific fields"*. The rule *prisme never edits a page after creating it*
  ([ADR-0025](0025-page-creation-needs-a-role-vocabulary.md),
  [ADR-0030](0030-page-stores-are-databases-with-native-templates.md) rule 7) covers the three
  `create`-only page stores, not this one. Nothing Accepted is contradicted.
- **Writes are level-triggered** ([ADR-0009](0009-level-triggered-reconciliation.md)), planned
  before they are applied, guarded by `last_applied`
  ([`16-sync.md`](../16-sync.md) §3–§5), and audited ([ADR-0031](0031-outward-writes-are-audited-and-pruned.md)).

## Decision

**An open objective's period can move in prisme, and the linked page's date column follows. It is
written every pass and restored when it is edited by hand.**

1. **An open objective can move.** `PATCH /objectives/:id` accepts `type` and `period`, together
   or either one alone. It does so while the objective's **stored** status is `draft` or `active`
   (`isObjectiveOpen` in `@prisme/domain`). The pair must agree: `YYYY` for annual, `YYYY-MM` for
   monthly (`periodMatchesType`), otherwise `422`. A `met`, `missed` or `dropped` objective is
   refused with `409`: it was judged against its period, and moving it afterwards would rewrite the
   judgement rather than correct a plan. The area stays fixed at authoring. The owner chose this
   bound over *only before the period starts* and *always*.
2. **Each move is an event.** `event_log.kind = 'period_changed'` records `before` and `after` as
   `{ type, period }`, with the actor. A request that sends the period the objective already has
   records nothing. The old rule's concern, attainment history, is kept by the log and by the bound
   in point 1 rather than by refusing every correction.
3. **The page's date column is the outward form of `period`**, P →, and a row is added to
   [`11-ownership.md`](../11-ownership.md) §6. It applies to an objective with an
   `external_page_id` when the objectives store has a date column chosen
   (`role_binding.date_property`). The column is set to the whole period: `2027` is 2027-01-01 to
   2027-12-31, and `2027-02` is its first to last day. `objectiveDatesOf` is the exact inverse of
   adoption's `objectivePeriodOf`, so an adopted page reads back as the period it seeded. No time of
   day is written.
4. **Written by every reconciler pass, level-triggered.** The step runs after the task-tool half,
   in the same lock and mode, in both the CronJob and `POST /sync`. It reads the whole objectives
   store, and a pure planner (`apps/sync/src/objective-pages/plan.ts`) compares each linked page's
   column with its objective's period. **A difference always resolves to prisme's value.**
   `last_applied` (entity kind `objective_page`, keyed by the page) only decides what the
   difference *was*:
   - the page still holds what prisme last wrote, or prisme never wrote it: an **update**;
   - it holds something else: a **hand edit**, which is restored and recorded in `sync_conflict`
     as `prisme_wins` on field `period`. This is [`16-sync.md`](../16-sync.md) §4's default, as it
     is for an anchor.

   Five cases write nothing, and the plan names them: the page is not an entry of the store, it is
   in the trash, it has no date column by that name, two objectives link the same page, or the
   period is not written the way its type says.
5. **A third capability: edit.** Beside `read` and `create`, `assertEditable` allows only
   `read_write` roles, and `objectives_db` is the only one. `DocToolClient.setEntryDate` **reads
   the entry before it writes** and refuses, sending nothing, unless three things hold: the entry's
   parent is the bound data source, it is not in the trash, and the property is a date. It then
   sends that one property's `{ start, end }`, addressed by the property's id. The writer port
   (`DocumentEntryWriter.setObjectivePageDates`) fixes the role so a caller cannot choose it. It is
   frozen under `SYNC_WRITE_ENABLED=false` and audited as `update_page` (migration 0018), like the
   other three ports.
6. **The task tool gets nothing**, because nothing in it carries an objective's period.

**Not decided here:**
- Writing an objective's title, status or area outward. That is P7's, and each would be its own
  `last_applied` field.
- A way to accept Notion's date when the two disagree. A conflict here is always `prisme_wins`, and
  the review's conflict step links an unresolved conflict to an initiative screen. Changing the date
  is done in prisme.
- *Merge* setting an objective's page link. That is #118's follow-up, unchanged: a merged objective
  gets its dates written once its link is set.

## Consequences

- **The first pass after this deploys rewrites every linked page whose dates differ from its
  objective's period.** An adopted page matches by construction. An objective created in prisme and
  linked to a page by hand may not. `prisme-sync plan`, or *Force sync*, lists those pages first.
- **Editing a linked objective page's date column in Notion stops being lasting.** The next pass,
  within fifteen minutes, puts prisme's value back and counts a conflict. The user guide says so,
  and the page is where the date is *shown*, not where it is *decided*. The date column of an
  unlinked page is untouched.
- **One more read per pass**, a full query of the objectives store, and only when at least one
  objective is linked. A store of one person's objectives is a page or two.
- **A read failure does not fail a pass, and a write failure does**, the same judgement as the
  creation ledger: a document tool that is down is logged, while a write that was attempted and
  failed is something a person should hear about.
- **The API's force-sync now runs this step too.** It has always been plan-only from the screen, so
  the pending-change count there now includes page writes.

## Alternatives

- **Let Notion own the date, and re-read it.** Rejected: that is two owners of one fact, which is
  the failure this repository was written against. It would also make the year an objective's
  weight belongs to depend on a column anyone can edit.
- **Movable only before the period starts.** It was offered and it keeps history strictly. The
  owner chose the open-status bound instead, which also corrects a period mis-set on an objective
  already running.
- **Always movable.** Rejected: a met or missed objective's period is part of the judgement that was
  recorded.
- **Write the page from `PATCH`, synchronously.** Rejected: it is edge-triggered. A failed write
  would be lost, with no plan and no dry run, and a hand edit in Notion would never be restored
  ([ADR-0009](0009-level-triggered-reconciliation.md)).
- **Delete and re-author the objective.** That loses its key results, their measurements and its
  history, which is the opposite of the old rule's point.
- **Grant `write` on the store without reading the entry first.** Rejected: the parent check is
  what confines the edit capability to the store's own entries rather than to every page the
  integration happens to see.

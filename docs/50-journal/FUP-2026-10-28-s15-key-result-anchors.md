# FUP · 2026-10-28 · S15: key results get their anchor tasks

**Agent:** Claude · **Duration:** one run · **PR:** [#200](https://github.com/vchatela-org/prisme/pull/200) · **Outcome:** the reconciler gives every
key result of an objective under way an anchor task — bound, linked or created — and keeps its
statement, deadline, label and backlink in step. S15 is closed.

## What was found first

- [ADR-0012](../20-decisions/0012-key-results-first-class.md), Accepted, says *every key result gets
  an anchor task*. The finding's second option — making *served by initiatives* the rule — would
  contradict it, so it needed an ADR and a stop; the first option is what the ADR asks for.
- A key result could already **hold** a task (S1's conversion; `key_result.external_anchor_id` and
  an `entity_external_ref` row with `prisme_kind = 'key_result'`), and the reconciler already
  treated such a task as taken (`boundElsewhere`). A *Link as key result* from the queue wrote an
  `entity_link` that nothing ever bound.
- The intent channel reads the anchor label as *make this an initiative*, so a key result's task
  cannot wear it. The adoption classifier already knows a key-result label, `prisme:kr`.

## What was done

- **Domain.** `keyResultAnchorDeadline(objective, today)`: an `active` objective whose period has
  started (ADR-0035) gives its key results anchors, with the period's last day as the deadline.
- **Desired state.** `DesiredState.keyResultAnchors`, loaded by the sync store with each key
  result's bound task, pending link and its area's home; the store takes the instance's timezone
  for *today* (the CronJob and the API's force-sync pass it).
- **Planner** (`planKeyResult`): a bound task is converged — title = statement, deadline, the
  `prisme:kr` label (removing the anchor label a converted initiative kept), the backlink line
  (`keyResultLine`, to the objective's page) — and never its priority; a hand edit of a managed
  field is a `review` that writes nothing; a missing bound task is a `review`, never a re-create; a
  decided link is an `adopt` (`bind_key_result_ref`); a key result with neither is a `create`
  (`create_key_result_anchor`) at its area's home, or a `review` without one.
- **Apply and store.** The two operations, `bindKeyResultRef` (binding, `external_anchor_id`, the
  link), the audit subject and event entity `key_result`.
- **Docs and copy.** `10-model.md` §7, `11-ownership.md` §6, `18-user-guide.md` §6,
  `19-how-it-works.md`; the objective page says whether its key result has its task yet.

## Decisions taken

- **Provenance without a column.** Guard 2 lets only `created_in_prisme` work create. Key results
  have no `origin` because adoption cannot make one (`needs_objective`): every key result is
  prisme's, and a task kept as one arrives as a pending link, which is honoured first. So *neither a
  task nor a link* is the creation condition.
- **No priority.** A key result is not ranked, so prisme claims none — not even at creation, where
  the task gets the tool's default.
- **Location only at creation.** An initiative's anchor is moved back into its area; a key result's
  is not, because nothing ranks it into one and moving a task someone filed is an opinion prisme
  does not need here.
- **Review, not conflict, for hand edits.** The conflict ledger resolves into an initiative's page;
  a key result is edited on Objectives. A review writes nothing and repeats until the two agree.
- **Subtree not mirrored.** Computed progress keeps coming from serving initiatives; reading the
  anchor's subtasks for progress would be a second definition beside ADR-0013's.

## Checks run locally

Node 24.21.0: root `pnpm typecheck`; the whole `unit` project, including nine planner tests
(`plan.key-results.test.ts`), two apply tests and the domain predicate; the whole `integration`
project, including a store test (which key results are offered, their task, link and deadline, and
the binding); eslint and prettier on the changed files; the privacy scan with the local supplement.

## Not done

- No subtree mirror or rollup for a key result's anchor.
- A key result's anchor completed in the task tool changes nothing in prisme; key results are
  judged at the review of their period.
- **For the live instance:** the first writing pass after this ships wants a task for every key
  result of an active objective under way that has none. With `SYNC_CREATE_THRESHOLD` below that
  count the pass is refused whole — and says so on Focus and Settings (S8) — until it is raised.

## Specs touched

- `docs/10-model.md` §7, `docs/11-ownership.md` §6, `docs/18-user-guide.md` §6,
  `docs/19-how-it-works.md` §3.3, §4, S1 and S15.

# FUP · 2026-10-28 · S1, third step: an initiative converts to a key result

**Agent:** Claude · **Duration:** one run · **PR:** this entry's own · **Outcome:** any open
initiative can be turned into a key result of an open objective, with its task moving to it. S1's
last *Explore* item is done, and S1 is closed.

#180 taught adoption to read a task kept as a key result, and #182 marked an initiative that looks
like one. This step answers that mark.

## What was done

- `POST /initiatives/:id/convert-to-key-result` with `{ objectiveId, statement, target, unit }`.
  In one transaction (`convertToKeyResult` in the API store):
  1. the key result is inserted under the objective;
  2. the initiative's task, if it has one, **moves** to the key result. It is deleted then
     inserted, as a capture's promotion does, so guard 1 never sees two owners;
     `key_result.external_anchor_id` names it, and a `manual` link records the decision in the
     ledger;
  3. the initiative is `dropped`, its anchor cleared, with the reason *Converted to a key result:
     …*;
  4. `status_changed` and an `adoption_decision` (`decision: convert`) reach the event log.
- Refused with `409`, writing nothing: an initiative already in `review`, `done` or `dropped`; an
  objective that is met, missed or dropped; a task link decided in Adoption that no pass has bound
  yet. The route needs `write:objective` as well as `write:initiative`, because it writes a key
  result.
- The reconciler's desired state gains `boundElsewhere`: tasks bound to a non-initiative entity.
  The intent channel never captures one, so the `prisme` label a converted task kept is not a
  request. A decided link naming one is a skip for finished work and a review for open work.
- The web: *Convert to key result* on the initiative's page. It sits beside the *Looks like a key
  result* mark, or under *Is it a key result?* for any open initiative. It offers open objectives,
  its own area first, says what will happen, and lands on the objective.
- The hint and the panel now sit below the title row. In the title column they were clipped on a
  narrow screen, which the harness run showed.

## Decisions taken

- **The binding moves, rather than staying on a dropped initiative.** Leaving the task as the anchor
  of a dropped initiative was the other option, and it needed no reconciler change. But the
  reconciler would then keep writing the dropped initiative's title, label and *lowest* priority to
  what is now the key result's task. That is an outward write nobody asked for. Moving the binding
  matches the ownership table's *key result anchor task*. Nothing writes to it yet; that is S15.
- **Dropped, not deleted.** The initiative's history and score history stay readable, and the
  reason says what it became.
- **No new event kind, so no migration.** The conversion is recorded as a status change plus an
  adoption decision, both existing kinds.
- **The pending-link case is refused, not handled.** Moving a binding that does not exist yet would
  leave the next pass to bind the task to the dropped initiative instead.
- **It depends on #183.** Without it, converting an initiative that never had a task would plan a
  `create` for the dropped initiative.

## Checks run locally

Node 24.21.0 (the repo pins 26; CI runs that):
- `pnpm typecheck`;
- the `apps/sync` suite, plus a new integration test for `boundElsewhere` against `prisme_test`;
- the `apps/api` conversion integration tests (7);
- the `apps/web` lib tests;
- eslint, prettier, and the privacy scan with the local supplement.

The local harness was driven end to end with a synthetic labelled goal: the Inbox mark, the panel,
the conversion, and the rows in the database afterwards.

## Not done

- The API's refusal sentence does not reach the screen. A refused conversion reads *Refused*, as
  every `409` does in the web tier. The panel only offers what the API accepts, so only the
  unbound-link case can reach it.
- No MCP write tool for the conversion.
- S15: nothing writes to a key result's task or reads its subtree yet.

## Specs touched

- `docs/10-model.md` §7, `docs/11-ownership.md` (the intent-channel row), `docs/16-sync.md` §4,
  `docs/18-user-guide.md` (*An initiative's page*, *Talking to prisme from Todoist*),
  `docs/19-how-it-works.md` §4, S1 and S15.

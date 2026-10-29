# FUP · 2026-10-29 · A key result's task is found in its objective's whole subtree, and may sit under a sub-objective

**Agent:** Claude · **Duration:** one run · **PR:** [#206](https://github.com/vchatela-org/prisme/pull/206) · **Outcome:**
[ADR-0039](../20-decisions/0039-a-key-result-may-sit-under-a-sub-objective.md). The reconciler looks
for a key result's task through its objective task's whole subtree, reading titles with their inline
markup set aside; it refuses to create beside hand-kept `KR`-shaped tasks, makes nothing for a key
result at 100%, and places a new one beneath its sub-objective's subtask. A key result gains an
optional `sub_objective`.

## What was found first

- **The first writing pass after v0.19.0 created 28 key-result tasks.** Counts only: 24 duplicated a
  task the owner already kept for that key result, and 4 were new open tasks for key results already
  at 100%, whose tasks had been completed months earlier. No other outward write was made by that
  pass beyond 5 objective-task updates, and none by later passes.
- **Why the 24 were missed.** The owner keeps objectives in three levels — objective task →
  sub-objective subtasks (`O<n> : …`) → key-result subtasks (`**KR<n>** : …`). ADR-0038's search
  looked at direct subtasks only, with an exact title. The key results were grandchildren, and the
  statements prisme held had the sub-objective folded in as a prefix, without the markup. Neither the
  exact nor the normalised test could match, so every one fell through to `create`.
- **Why the 4 were made.** Nothing stopped a create for finished work. ADR-0035 and `planUnlinked`
  already refuse an anchor for a finished initiative; key results had no equivalent.
- The owner chose: keep the tasks simple (`KR<n> : text`, with the parent task showing the
  sub-objective), and add sub-objectives to prisme rather than keep two levels.

## What was done

- **Domain.** `renderedTitleForm` / `isSameRenderedTitle`: rule 2's exact form after emphasis
  (`**`, `__`, `~~`) and links (drawn as their text) are removed, so it stays exact — case, accents
  and punctuation count. `looksLikeKeyResult`: `KR<n>` at the start once the markup is gone.
- **Reconciler.** `planKeyResult` searches `descendantsOf` the objective's task, adopts the one task
  that reads as the statement (`exact_title`), reviews two, skips a key result at `progress_self`
  ≥ 100, reviews a normalised-only match, reviews when free `KR`-shaped tasks exist and none matches,
  and otherwise creates beneath the direct subtask that reads as the key result's `sub_objective`
  (or beneath the objective's task; two such subtasks are a review). `DesiredKeyResultAnchor` gains
  `subObjective` and `progressSelf`, loaded by the store.
- **Schema.** Migration 0024: `key_result.sub_objective`, nullable text, 1–200 characters. The
  reversal was rehearsed with a key result carrying one, in a rolled-back transaction on a throwaway
  database.
- **API, MCP, web.** `subObjective` on the key-result DTO, the create body and the update body
  (`null` clears it); the MCP objectives read carries it; Objectives groups key results by
  sub-objective, the detail page names it, and the add form asks for it with the existing ones
  suggested.
- **Specs.** `10-model.md` (the field and the two never-created cases), `11-ownership.md` §6 (two
  rows, and the anchor row), `16-sync.md`, `18-user-guide.md`, `19-how-it-works.md`, ADR-0038's
  header, the ADR index.

## Tests

Eleven planner cases in `plan.key-results.test.ts`, the adversarial ones first: a three-level tree
of hand-kept key results with markup produces **zero creates**; `KR`-shaped subtasks that do not
match produce a review and no create; a key result at 100% produces no create, and still adopts an
open task that reads as it; a unique near match is a review, never a bind; placement under the
sub-objective, under the objective when none matches, and a review when two do. Domain tests for the
rendered form (including that a lone `*` survives and that case and accents still count) and the
`KR` shape. A route integration test for `subObjective` set, kept on an unrelated patch, and cleared
by `null`. Web tests for the grouping.

## Not done

- **Completed subtasks are not searched**: the read path returns open tasks only. The 100% skip covers
  the observed case.
- **No screen edits an existing key result's statement or sub-objective**; the API does
  (`PATCH /key-results/{id}`).
- **The objective's own task keeps ADR-0038's exact-title rule**; the markup-tolerant form is used for
  key results only.
- **The instance repair is not in this repository**: rewriting the statements into `sub_objective`
  plus `KR<n> : text`, and clearing the bindings to the deleted copies, are a data change made against
  the live instance once this is deployed.

# FUP · 2026-10-29 · An objective holds its task, and its key results' tasks go beneath it

**Agent:** Claude · **Duration:** one run · **PR:** — · **Outcome:**
[ADR-0038](../20-decisions/0038-an-objective-holds-its-task.md). An initiative whose task carries
exactly an open objective's title, in its area, gives that task to the objective on the next pass
and is dropped, so objectives never take a slot. A key result's task is found among, or made as, the
subtasks of its objective's task, and an objective with no task gets none made.

## What was found first

- **Objectives never took a slot in the code.** Selection reads initiatives only. On the live
  instance (counts and shapes, no titles), 6 of the 8 initiatives carried exactly an open objective's
  title in the same area. They were the owner's objective tasks, brought in by the label, and two of
  them were `next` and so offered *Suggested* slots on Focus. Each of those tasks has two to five
  subtasks.
- **S15, released in v0.18.0 and never deployed,** would have created one top-level task per key
  result at its area's home: 48 key results under way, none bound. The deployment's create threshold
  is 0, so the first pass would have been refused whole, anchor updates included, until the threshold
  was raised. After that it would have put 48 new tasks beside objective tasks that already hold their
  key results as subtasks.
- The owner chose: give each objective its task automatically, create key-result tasks as subtasks
  after matching existing ones, and create none for an objective without a task.

## What was done

- **Domain.** `objectiveTaskMatches` and `isSameTitle` (rule 2's `exactTitleForm`): exact title,
  same area, exactly one open objective that holds no task, one initiative per objective.
- **Sync, before the reconciler.** `objective-tasks/`: `giveObjectivesTheirTasks` and its store. The
  binding moves to the objective (`prisme_kind = 'objective'`), the initiative is dropped without its
  anchor and with the reason, the link is recorded as `exact_title`/`certain`/`auto`, and a
  `status_changed` and an `adoption_decision` event are written, in one compare-and-set transaction.
  It runs after the objective windows in both entrypoints.
- **Reconciler.** `DesiredState.objectiveTasks` and `DesiredKeyResultAnchor.objectiveTaskId`, loaded
  by the store. `planObjectiveTask` converges the deadline, `prisme:objective` in place of the
  anchor label, and the backlink (`objectiveLine`, marker *deadline, label*); never the title. In
  `planKeyResult`, an exact-title direct subtask is adopted (`bind_key_result_ref` with
  `match: 'exact_title'`), a normalised-only match or two exact ones are a `review`, otherwise the
  task is created with `parentId`, and an objective without a task is a `skip`. The area-home
  creation path is gone.
- **Connector.** `AnchorDraft.parentId` is sent as `parent_id`, without a section, which the tool
  takes from the parent.
- **Apply.** An `exact_title` bind records an automatic, certain link. Actions about an objective are
  audited and logged against it.
- **Docs.** ADR-0038, ADR-0012's status line, the ADR index, `11-ownership.md` §6 (three new rows),
  `10-model.md` §7, `16-sync.md`, `18-user-guide.md`, `19-how-it-works.md` (§4 table, S15, the key
  result row).

## Decisions taken

- **Exact title, not normalised.** `title.ts` forbids auto-linking on a normalised match. The
  normalised form is used only to keep a near-copy from being created.
- **A `skip`, not a `review`, for a key result whose objective holds no task.** That objective is
  kept somewhere else on purpose, and a review line every fifteen minutes would be noise.
- **The step lives outside the planner**, like the windows, so the create threshold, which refuses a
  whole plan, cannot hold the objectives' tasks hostage to the key results' creations.

## Checks run locally

Node 24.21.0 (the repository pins 26). Domain tests: the matching rule, every refusal case, and
ordering. Planner tests: 7 new key-result cases and 5 objective-task cases. The writer's `parent_id`
test. The apply suite. Two PostgreSQL suites: the move, idempotence, `plan`, a lost race, and the
store's `objectiveTasks` and `objectiveTaskId`. The full suite is listed in the pull request.

## Not done

- No screen shows the objective's task, and none undoes a match. The event log holds both sides.
- An objective's task subtree is not mirrored. Computed progress still comes from serving
  initiatives (ADR-0013).
- **For the live instance:** the first writing pass wants a subtask for every key result that has no
  exact-title subtask, under the five annual objectives under way that hold a task. The deployment
  must raise `SYNC_CREATE_THRESHOLD` above that count for the rollout.

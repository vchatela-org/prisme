# ADR-0039 · A key result may sit under a sub-objective, and its task is found in its objective's whole subtree

**Status:** Accepted · 2026-10-29 · decided by the owner, 2026-10-29. In part supersedes
[ADR-0038](0038-an-objective-holds-its-task.md) decision 4: how a key result's task is found and where
one is made. Amends [ADR-0012](0012-key-results-first-class.md): a finished key result gets no task.

## Context

ADR-0038 let an objective hold its own task and placed its key results' tasks beneath it. Before
creating one, it looked for a **direct subtask** whose title was **exactly** the statement.

A common way of keeping objectives has **three levels**: the objective, a handful of sub-objectives
(`O1`, `O2`, …), and the key results under each, written with the tool's own markup
(`O1 : **Ship early**` → `**KR1** : Ship one quick win`). prisme had two levels, so a sub-objective
could only be folded into every statement (`O1 Ship early · KR1 : Ship one quick win`).

The first pass with ADR-0038 deployed on the owner's instance therefore **created one task per key
result** beside the one already kept by hand: those were grandchildren, not children, and their
titles differed by the sub-objective prefix and the markup. The same pass also created open tasks for
key results already at 100%, whose tasks had been completed months earlier. Every one of those creates
was the near-copy ADR-0038 meant to prevent. They were deleted by hand and the bindings repaired.

The owner's answer, on the task's title: *"I can see the parent name in the task tool, so there is no
need to duplicate it in the child if it has a parent hierarchy. Keep the tasks simple: `KRn : text`."*

## Decision

1. **A key result may name a sub-objective** — `key_result.sub_objective`, free text, optional,
   prisme's. It groups key results on Objectives. It is not an entity: no status, no score, no task
   prisme manages. The statement no longer has to repeat it.
2. **The task title is still the statement**, and still prisme's (`11-ownership.md` §6). With the
   sub-objective held apart, the statement is what the task should read, e.g. `KR1 : Ship one quick
   win`, beneath the sub-objective's subtask.
3. **A key result's task is looked for in its objective task's whole subtree**, not just among its
   direct subtasks. In order, for a key result with neither a bound task nor a decided link:
   - **one** free task in the subtree that **reads as** the statement is adopted (`exact_title`) and
     creates nothing. *Reads as* is rule 2's exact form after the inline markup the tool renders
     invisibly is removed — emphasis (`**`, `__`, `~~`) and links drawn as their text
     (`renderedTitleForm`). Case, accents and punctuation still count, so this is exact, not rule 3.
     Two such tasks are a `review`;
   - a key result whose `progress_self` is **100 or more gets no task made**. It is finished work;
     an open task would say otherwise. One that reads as it is still adopted;
   - a free task in the subtree whose title only **normalises** to the statement is a `review`, as
     before;
   - **if the subtree holds any free task shaped like a key result** (`KR<n>` at the start, once the
     markup is gone — `looksLikeKeyResult`) and none reads as the statement, it is a **`review`,
     never a create**: somebody already keeps key results here, and a create would put a copy beside
     the one they meant. Renaming one is the owner's answer, and the next pass binds it;
   - otherwise a task is **created**: beneath the objective task's **direct subtask that reads as the
     sub-objective** when exactly one does, beneath the objective's task when none does, and a
     `review` when two do.
4. Once bound, the title converges to the statement as before. On a hand-kept task that differs only
   by markup, that is a rename to the plain statement — the "simple" form the owner asked for.

## Consequences

- **The repair on the owner's instance is a data change, not code:** the statements are rewritten to
  `KR<n> : <text>` with the `O<n>` part moved into `sub_objective`, the bindings to the deleted
  copies are cleared, and the next pass adopts the hand-kept tasks itself. The handful whose words
  differ beyond markup are linked by hand.
- **Refusing is the default when key results are already kept by hand.** An objective task holding
  `KR`-shaped subtasks never gets a task created beneath it by prisme, whatever its key results say.
  The cost is a `review` line where a create would have been right. That is the safe direction.
- **Completed subtasks are not searched**, because the read path returns open tasks only. The 100%
  skip covers the case that produced creates; a key result below 100% whose hand-kept task was
  completed will still get a task, and its `KR`-shaped siblings, if any are open, make that a review.
- **The objective's own task keeps ADR-0038's exact-title rule.** The markup-tolerant form is used
  for key results only, where the failure was observed.

## Alternatives

- **Keep two levels and decide the title format only.** Rejected by the owner: the sub-objective
  is how the goals are thought about in both tools, and folding it into every statement made both the
  task title and the prisme screen longer for no information.
- **Match on the normalised title (rule 3).** Rejected for binding, for the reason ADR-0038 gives:
  two different titles can normalise alike. Markup removal is narrower — the two strings *render* as
  the same words.
- **Strip a leading `O<n> … ·` prefix from the statement when matching.** Rejected: it encodes one
  instance's old import format into the planner. The sub-objective field removes the prefix at the
  source instead.
- **Make the hand-kept task's title the owner's once adopted** (as an objective's own task is).
  Rejected by the owner: they asked for prisme to keep the key results' tasks simple.

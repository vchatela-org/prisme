# ADR-0038 · Let an objective hold its own task, and put its key results' tasks beneath it

**Status:** Accepted · 2026-10-29 · decided by the owner, 2026-10-29. In part supersedes
[ADR-0012](0012-key-results-first-class.md): a key result's task is made only beneath its
objective's task. It also amends how S15 placed one, which was at its area's home. Decision 4's search (direct
subtasks, exact title) is in part superseded by
[ADR-0039](0039-a-key-result-may-sit-under-a-sub-objective.md): the whole subtree, markup aside.

## Context

A common way to keep objectives in the task tool is **one task per objective**, worked on all
period, with the key results and the work under it as subtasks. The owner's instance is set up this
way. Its intent label brought those tasks into prisme as **initiatives**: one-to-six-week outcomes,
ranked, suggested for a `now` slot and counted by Focus. This is failure 3 of
[`00-vision.md`](../00-vision.md), *objectives written as tasks are never read as objectives*,
recreated inside prisme. The owner's words: *"my objectives (yearly and monthly) are there all the
year, they must not count in the slots."*

What already existed:

- **S1** marks such an initiative *Looks like a key result* (`objective_title`, a normalised title
  equal to an open objective's in its area) and lets a person *Convert to key result* one at a time.
  Converting makes a key result of what is really the objective itself.
- **S15** (v0.18.0, never deployed) gives every key result of an objective under way an anchor task.
  When it has neither a task nor a link, the task is **created at its area's home**. On the owner's
  instance that meant one new top-level task per key result, beside the objective tasks that already
  hold those key results as subtasks. The create threshold of 0 would also have refused the whole
  first pass.

## Decision

1. **An objective can hold a task** of its own: an `entity_external_ref` row with
   `prisme_kind = 'objective'`, one per objective. Like any non-initiative binding, the task is
   *taken*: the intent channel never makes it an initiative, and no link may bind it to one.
2. **Recognised without asking, narrowly** (`objectiveTaskMatches`). An initiative's task becomes its
   objective's when all of these hold:
   - the initiative holds a task and is not closed;
   - its title is **exactly** an open objective's title, in rule 2's form (`exactTitleForm`:
     whitespace and Unicode normalisation do not count; case, accents and punctuation do);
   - the initiative and the objective are in the same area;
   - exactly one objective matches, that objective holds no task yet, and no other initiative
     matches it.

   The task moves to the objective. The initiative is dropped without its anchor, with a reason
   saying why. The link is recorded as `exact_title`, `certain`, `auto`. A `status_changed` and an
   `adoption_decision` event are written, all in one transaction. This step runs in every pass,
   after the objective windows ([ADR-0037](0037-an-objective-follows-its-window.md)) and before the
   reconciler. It writes prisme's own tables only. Anything less certain is still left to S1's
   *Convert* or to a person.
3. **prisme owns three things on an objective's task while it is under way:** the **deadline** (the
   period's last day), the **objective label** (`prisme:objective`, which replaces the anchor label
   the task arrived with) and the **backlink line** (the objective's page in prisme). It does not own
   the title, which is the owner's wording, nor the priority, the place or the completion. A hand
   edit of a managed field is a `review`, as for a key result's task. When the objective is judged,
   prisme stops managing the task and never closes it.
4. **A key result's task is made beneath its objective's task.** For a key result with neither a
   bound task nor a decided link:
   - a **direct subtask** of the objective's task whose title is exactly the statement, free of
     other bindings, is **adopted** (`bind_key_result_ref`, `exact_title`). It creates nothing. One
     subtask goes to one key result per pass, and two subtasks carrying the same statement are a
     `review`;
   - a subtask whose title only **normalises** to the statement is a `review`, never a guess.
     Binding it would rename somebody's subtask, and creating a task would put a near-copy beside
     it. Making the two titles identical is the owner's one-line answer, and the next pass binds it;
   - otherwise a subtask is **created** beneath the objective's task (`parent_id`). The tool places
     it in its parent's section;
   - **an objective that holds no task gets no tasks made for its key results.** This is a `skip`,
     not a question: such an objective is kept somewhere else, and a top-level task per key result
     is the noise this decision removes. A key result can still be linked or bound by hand.
5. **Only initiatives take a slot.** Nothing about an objective, its task or its key results' tasks
   counts in the work-in-progress limits
   ([ADR-0036](0036-work-in-progress-limits-are-soft-and-chosen-on-settings.md)).

## Consequences

- **On the owner's instance**, the first pass after this ships gives six objectives their tasks.
  Those were the initiatives whose title is exactly an objective's in the same area, and they leave
  Focus, the Inbox and the slots. The key results of the objectives under way that hold a task are
  then matched among their subtasks or created beneath them. That count can be above the
  deployment's create threshold, which refuses the whole pass: the threshold has to be raised for the
  rollout (the create threshold is still the ceiling on what one pass may create).
- **ADR-0012's "every key result gets an anchor task"** now reads: every key result whose objective
  holds a task. The anchor still exists so subtasks can hang beneath it, which was the point.
- **The initiatives dropped this way keep their history.** Their events and links stay, and the
  reason says what happened. No screen undoes a match yet. A wrong one is corrected by hand from what
  the event log recorded on both sides. That is acceptable only because the rule is exact.
- **The cost:** an exact-title rule misses an objective whose task is worded differently. That one
  stays an initiative, marked *Looks like a key result* by S1's normalised hint, until a person
  converts it or makes the titles identical. Missing a match is the safe direction.

## Alternatives

- **Exclude objective-like initiatives from the slots, and keep them as initiatives.** Rejected: the
  model would still say they are one-to-six-week outcomes, and every other screen would go on ranking
  and scoring them. The owner chose to fix the model, not the count.
- **Leave it to *Convert to key result*, one click each.** Rejected for these: it makes a key result
  of what is the objective itself, and the owner chose automatic over manual.
- **Match on the normalised title (rule 3).** Rejected: `title.ts` itself says a normalised match
  is never auto-linked, because two different titles can normalise alike. Only the review line uses
  it, to keep a near-copy from being created.
- **Create key results' tasks at the area's home, as S15 did.** Rejected by the owner: one
  top-level task per key result beside objective tasks that already hold them.
- **Mirror the objective task's subtree for computed progress.** Not now. Computed progress keeps
  coming from the initiatives that serve a key result (ADR-0013). A second definition would need
  its own decision.

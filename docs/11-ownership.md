# 11 · Ownership matrix

**The contract.** Every field belongs to exactly one store. This document is the authority; if code
and this file disagree, the code is wrong.

A previous attempt at this system failed partly because ownership was assigned *per object* —
"the document tool owns initiatives, the task tool owns tasks". That sounds clean and collapses
immediately, because a single initiative has fields that genuinely belong on both sides: its
priority is a decision, its due date is a plan, and those are different people's business even when
that person is the same human on different days.

Per-field ownership makes conflicts resolvable by rule instead of by merge logic.

---

## 1. Legend

| Symbol | Meaning |
|---|---|
| **P** | prisme owns it — it is the source of truth |
| **D** | The document tool owns it |
| **T** | The task tool owns it |
| **∂** | Derived by prisme from data it does not own; read-only everywhere |
| → | prisme writes this outward |
| ← | prisme reads this inward, and never writes it |
| ⇢ | prisme *propagates* into a field it does not own, under the overwrite guard. The owner still wins — see [`16-sync.md`](16-sync.md#5-overwrite-protection) |

**Owner and flow are different columns for a reason.** One field, one owner, always — but a field
someone else owns may still be written by prisme, under a rule that states exactly when it may not.
That is a flow, not shared ownership, and it happens exactly once in this document (§5).

---

## 2. Area

| Field | Owner | Flow | Notes |
|---|---|---|---|
| `key`, `name`, `kind`, `active` | **P** | — | |
| `weight_pct` per year | **P** | — | Never mid-year. See [`10-model.md`](10-model.md#weights-are-year-scoped) |
| `run_budget_hours_per_week` | **P** | — | Only for `kind = run` |
| `color_slot` | **P** | — | Palette slot 1–8, chosen on the Settings screen. Presentation only; never leaves prisme |
| Narrative description of the area | **D** | ← | What the area *means*; prose |
| `area_mapping` → external project/section | **P** | — | Config, many-to-one. Nothing moves in the task tool when it changes |
| `area_mapping.is_home` | **P** | — | Where prisme creates new work for the area (anchors, captures). At most one per area |
| `actual_share`, `balance_factor` | **∂** | — | From completions in the last 4 weeks |

## 3. Project

| Field | Owner | Flow | Notes |
|---|---|---|---|
| `name`, `area_key`, `status`, `deadline` | **P** | → | Name propagates to both tools |
| `sections[]` | **P** | → | Become sections in the task tool |
| Project page body and narrative | **D** | ← | Created once from template, then yours |
| Tasks inside the project | **T** | ← | Never mirrored |
| `external_page_id`, `external_project_id` | **P** | — | Set once at creation or adoption |
| `origin` | **P** | — | Immutable after creation |

## 4. Initiative

| Field | Owner | Flow | Notes |
|---|---|---|---|
| `title` | **P** | → | Written to the anchor's title |
| `area_key`, `project_id` | **P** | → | Determines the anchor's project/section |
| `status` | **P** | → | Drives anchor priority and existence |
| `value`, `time_criticality`, `risk`, `size` | **P** | — | Never leave prisme |
| `deadline` | **P** | → | Written to the anchor's deadline field |
| `earliest_start`, `depends_on[]` | **P** | — | Scheduling only |
| `planned_start`, `planned_end` | **∂** | — | From the schedule engine |
| Score, cost of delay, balance | **∂** | — | From the active scoring method |
| Anchor **label** | **P** | → | The marker identifying an anchor |
| Anchor **description backlink** | **P** | → | First line; includes the managed-fields marker |
| Anchor **priority** | **P** | → | From status and rank |
| Anchor **due date** | **T** | ← | **prisme never writes this** |
| Anchor **completion** | **T** | ← | Completing it moves prisme status to `review` |
| Narrative page body | **D** | ← | Optional, created on demand |
| `progress`, `open_task_count`, `last_activity` | **∂** | → | Derived, may be surfaced outward read-only |

### Why `title` flows outward but the page body does not

The title is an identifier that must match on both sides for a human to trust the link. The body is
prose, and prose belongs where prose is written. prisme has nothing to say in it.

## 5. Task

| Field | Owner | Flow | Notes |
|---|---|---|---|
| Content, description, subtasks at any depth | **T** | ← | Never mirrored, only counted |
| `due` date, recurrence | **T** | ← | Yours. Read for planned-vs-done only |
| Labels other than the anchor marker | **T** | ← | |
| Comments, attachments | **T** | — | Not read at all |
| Priority on a **subtask** | **T** | ⇢ | Propagated from the anchor, but only while untouched — see the rule below |
| Completion, `completed_at`, duration | **T** | ← | The raw material for capacity actuals |

### The subtask priority rule

prisme propagates the anchor's priority down to subtasks so that a focused view surfaces the right
work. But a priority *you* set must survive. The rule:

> prisme may overwrite a subtask's priority only if its current value equals the value prisme last
> wrote. Otherwise the field has been touched by hand and becomes yours permanently.

This needs the `last_applied` table and is the reason it exists. Without it the choice is between
never propagating (useless) and stomping deliberate edits (infuriating).

**The owner is the task tool throughout.** prisme writing a value does not make it prisme's field —
the guard exists precisely so the owner keeps the last word. [ADR-0008](20-decisions/0008-field-level-ownership.md)
anticipated this single nuance and named the machinery it requires; it is not an exception to
one-owner-per-field, it is what one-owner-per-field costs.

## 6. Objective and Key Result

| Field | Owner | Flow | Notes |
|---|---|---|---|
| `title`, `type`, `period`, `area_key`, `status` | **P** | → | Authored in prisme |
| Objective narrative, reflections, review notes | **D** | ← | Prose |
| Key result `statement`, `target`, `unit` | **P** | → | |
| `progress_self` | **P** | → | Self-assessed; **this** is what syncs outward |
| `progress_computed` | **∂** | — | Shown beside it, **never** written outward |
| `measurements[]` | **P** | — | Append-only |
| Key result **anchor task** | **P** | → | So subtasks can hang beneath it |
| Subtasks under a key result anchor | **T** | ← | Yours |

## 7. Takeaway and media

| Field | Owner | Flow | Notes |
|---|---|---|---|
| Everything — title, kind, body, links, status | **D** | ← | prisme mirrors, writes nothing |
| Media library in full | **D** | ← | Read-only |
| Promotion link → initiative | **P** | — | Held in prisme; the takeaway is unmodified |
| Legacy score / priority / workload properties | — | — | **Removed.** Scoring lives in prisme (ADR-0013) |

## 8. Run, Signals, Ritual

| Field | Owner | Flow | Notes |
|---|---|---|---|
| Process pages: procedure, duration, frequency | **D** | ← | **Read-only. prisme writes nothing here** (ADR-0016) |
| Recurring tasks | **T** | ← | |
| Run hours consumed vs budget | **∂** | — | Completions × declared duration |
| Ritual definition: area, cadence, target adherence | **P** | — | |
| Ritual adherence series | **∂** | — | The metric neither tool provides |
| Signals volume | **∂** | — | Counted as noise; excluded from capacity |

## 9. prisme-only

No external counterpart. Listed so it is obvious that syncing them would be a mistake.

| Entity | Notes |
|---|---|
| Scores, all methods and versions | Append-only; history of *how* things were ranked |
| Event log | Also the security audit trail |
| Review sessions and their decisions | Narrative summary is pushed outward; the structure is not |
| Reconciliation state: sync token, watermark, `last_applied`, conflict ledger | In PostgreSQL |
| Adoption decisions, including "ignored" | So the adoption queue converges |
| API tokens, sessions | See [`14-threat-model.md`](14-threat-model.md) |

---

## 10. Conflict resolution

A **conflict** is a change, made in an external tool, to a field prisme owns.

**Default: prisme wins.** The next run restores prisme's value and writes a ledger entry.
Predictable, no merge logic, no lost decisions.

That would be hostile on its own — sometimes the task tool is the only thing available. So certain
edits are reclassified as **requests**, not conflicts:

| You do, in the task tool | prisme does |
|---|---|
| Add the anchor label to any task | Creates the initiative (status `inbox`), links both |
| Complete an anchor | Moves status to `review` for you to confirm |
| Add a status-request label | Moves status, then removes the label |
| Edit `due`, subtasks, comments, content | Nothing — those are yours |

Anything legitimately needed from a phone has a sanctioned channel; everything else is owned and
enforced. Full policy in [`16-sync.md`](16-sync.md#4-conflicts).

**Ownership is advertised where it would be broken.** Every anchor's description ends with a
managed-fields marker, so the fields prisme controls are visible in the tool where you might
otherwise change them.

---

## 11. Adding a field

1. Decide the owner **before** writing code, using the test below.
2. Add it here, in the right table.
3. If the owner is not prisme, add it to the connector's read path and decide whether a conflict on
   it is an error or a request.
4. If prisme writes it outward, add it to `last_applied` so overwrite-protection works.

### The test

> **Who is right when the two disagree?**

Not "where is it most convenient to edit", not "where does it look nicest". If the honest answer is
"it depends", the field is doing two jobs and should be split into two fields — which is exactly
what happened with `deadline` and `due`.

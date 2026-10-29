# ADR-0041 · A label can put a task in the Signals lane, wherever it sits

**Status:** Accepted · 2026-10-29 · decided by the owner, 2026-10-29. Amends how
[ADR-0014](0014-lanes-outside-the-backlog.md) places work in the Signals lane: *own project* stays
one way in, and a label chosen on Settings becomes a second one.

## Context

[ADR-0014](0014-lanes-outside-the-backlog.md) puts machine-generated notifications in the Signals
lane, which is excluded from ranking and from capacity and counted only as volume. It assumed
Signals live in **their own project**. Lanes are areas of a different kind, and an area's work is
found through `area_mapping`, which is a **location**: a project, optionally refined by a section.

Real automations do not write into a dedicated project. A newsletter briefing, a website-change
alert or an appliance reminder is written by its automation **into the section of the area it is
about**. On the owner's instance the Signals lane therefore had no mapping at all, and every such
task counted as that area's work. Each completion added the default duration to the area's observed
share, so the balance factor read machine output as attention the owner had chosen to spend.

Moving those tasks into a project of their own is the automation's change, made once per
automation. It splits a stream the owner reads in context, and it breaks again the next time an
automation is added. Location cannot express *what made the task*. A label can, and automations can
set one.

## Decision

1. **A lane label.** Settings → *Signals lane label* names one task-tool label and the Signals lane
   it puts work in. Stored in `signals_label_setting` (migration 0026), a singleton like
   `selection_setting`. `GET /settings/signals-label` and `PUT /settings/signals-label` require
   `admin:settings`.
2. **The label beats the location, for Signals only.** A task carrying the label is attributed to
   the named Signals lane **wherever it sits**: in an area's section, in an unmapped project, or in
   the inbox. The rule is `signalsAreaByLabel` in `apps/sync/src/signals-label.ts`, and both readers
   use it: the backfill's attribution for completions, and the adoption scan for open tasks, which
   then classifies the task as a signal and does not propose it. Every other lane is still decided
   by location alone.
3. **The lane is named, never inferred.** An instance may hold more than one Signals lane, so the
   setting names the area. The API refuses an area that is not of kind `signals` (`422`). If an area's
   kind changes later, the sync ignores the label rather than move noise into an area. Deleting the
   area deletes the setting.
4. **Unset is off.** With no row, attribution is exactly what it was before this record. Nothing is
   inferred from label names.
5. **prisme's own labels are refused.** The anchor marker `prisme` and the `prisme:` vocabulary
   (status requests, `prisme:objective`, `prisme:kr`) cannot be a lane label. The anchor label makes a
   task an initiative and cannot also make it noise.
6. **Labels are recorded on completions, read-only.** `completion_history.labels` holds the labels
   the task tool reported, so that attribution can be **re-made on every run** without a fetch
   (0006's rule). `NULL` means *not known*. A re-fetch fills it, and a response without labels never
   erases what is held. prisme never writes the label. It belongs to the task tool and to the
   automations that set it ([`11-ownership.md`](../11-ownership.md) §5).

## Consequences

- An automation's output stops inflating its area's share. It is counted where Signals are counted,
  as volume on `/kpi` and on the Signals lane's page.
- A change to the setting applies **at the next capacity refresh** (the daily full pass), which
  re-attributes the trailing window from stored history. Completions fetched before 0026 have no
  recorded labels. They keep their location's attribution until a fetch covers them again: the
  trailing window converges on the first refresh, and older history needs a
  `prisme-sync backfill --from` earlier than the cursor's start. That is the same rule ADR-0032 gives
  titles.
- One label, one lane. A second label, or a label for Run, would be a new decision. The rule is
  written so that adding one changes the setting's shape, not the attribution order.
- The task tool's label vocabulary is now read for one more purpose. The label's *name* is instance
  data. It lives in the database and on the Settings screen, never in the repository.

## Alternatives

- **Map the automations' sections to the Signals lane.** Rejected: an area section holds the owner's
  own work beside the automation's. Mapping it would move both, which is the same error in the other
  direction.
- **A dedicated Signals project, as ADR-0014 assumed.** Kept as a way in, and rejected as the
  *only* way in: it asks every automation to change where it writes, and it separates a signal from
  the area it is about.
- **Infer Signals from the task's author, or from a title pattern.** Rejected: the author is not in
  the completion record, and a title pattern is a guess. A wrong guess silently removes real work
  from an area's share.
- **Exclude labelled tasks from capacity without a lane.** Rejected: Signals are *counted*. The
  volume of noise is the measure ADR-0014 keeps, and dropping it would hide a stream that grows.

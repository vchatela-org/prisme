# FUP · 2026-10-29 · OQ-3's trigger fired; two questions opened

**Agent:** Claude · **Duration:** one run · **PR:** this branch's pull request · **Outcome:** OQ-3 is
answered in part and narrowed; OQ-11 (routines) and OQ-12 (multi-month and already-judged
objectives) are opened with triggers. Docs only.

## What was found

An alignment review on 2026-10-29 read the live instance against both tools (counts and shapes; the
values stay out of this repository). Three of its findings are OQ-3's trigger — a month of use, and a
wrong attribution traced to a mapping rather than to the work:

- **The task tool's inbox was mapped as one area's home.** Inbox completions counted as that area's
  work, and prisme-created work for the area landed in the inbox. The spec already says the inbox
  belongs to no area (S11, *Unsorted*); the mapping contradicted it and nothing refused it.
- **One finance-shaped section was mapped to another area.**
- **Automation-made tasks are written into area sections**, so newsletters, change alerts and
  appliance reminders counted as area work. The Signals lane had no mapping at all, because a lane can
  only be mapped by location and the automations write into area locations.

Also observed, and the reason the answer below includes renaming: section names in the task tool
carried **percentage weights** — one project's added up to more than 100%, from before this year's
weights — which contradicts ADR-0007 (weights are prisme's, per year).

## What was decided

The owner chose a **light restructure, not an alignment** (2026-10-29):

- section names stop carrying weights — done by hand in the task tool;
- the inbox belongs to no area — Settings refuses or warns on mapping it (a follow-up in the same
  wave), and the instance's home mapping moves;
- the misfiled section is re-mapped on Settings;
- automation-made tasks reach Signals by a **label** rather than by moving them (ADR-0041, in the same
  wave).

**Not chosen:** aligning both tools to one area list. OQ-3 stays open for that half, with a narrower
trigger: a wrong attribution traced to a mapping after these fixes have run a month.

## Opened

- **OQ-11** — a ritual is one process page and one recurring task; routines group several processes
  into one recurring task. Waits on recurring completions being read and a routine's adherence.
- **OQ-12** — objectives spanning two months cannot be adopted, and a past objective adopted today is
  closed `missed` by ADR-0037 whatever the document tool says. Waits on the owner choosing to adopt
  history, or writing a multi-month objective.

## Not done

- No ADR for OQ-3's partial answer: each part is either a tool-side edit or carried by its own change
  (ADR-0041, the inbox guard). The decision is recorded here and in `OPEN.md`.
- OQ-5's trigger still cannot fire until recurring completions are read; that is ADR-0040's work, not
  this entry's.

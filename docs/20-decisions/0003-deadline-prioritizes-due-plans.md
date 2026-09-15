# ADR-0003 · Deadlines prioritize, due dates plan

**Status:** Accepted · 2026-09-15

## Context

The task tool has two date fields. A *deadline* is a hard limit; a *due date* is when you intend to
work on something. Both plausibly relate to prioritization, and it was unclear how prioritization
should account for each.

Syncing the wrong one is a common and damaging mistake: writing a computed due date overwrites the
user's own plan for their week.

## Decision

The two fields have **different owners and different jobs**.

| Field | Meaning | Owner |
|---|---|---|
| `deadline` | Hard external constraint | **prisme** → written to anchors |
| `due` | When I intend to work on it | **The user, in the task tool.** prisme never writes it |

Deadlines feed time criticality and therefore the score. Due dates are read back only to measure
planned-versus-done, detect an overloaded week, and drive the weekly review.

## Consequences

- The two never compete, because they are never owned by the same side.
- Weekly planning stays entirely manual and entirely the user's — which is correct: it depends on
  energy, travel and mood that prisme cannot see.
- A deadline within 14 days forces maximum time criticality, so genuine urgency still dominates.
- Deadlines in the task tool apply to non-recurring tasks, which anchors always are.

## Alternatives

**Sync due dates from a computed schedule.** Rejected: it overwrites the user's plan, and prisme
lacks the context to schedule a specific day well.

**Ignore due dates entirely.** Rejected: reading them is what makes planned-versus-done measurable,
and that gap is one of the more useful review signals.

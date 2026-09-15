# prisme

Personal prioritization platform — the to-go command centre for deciding *what comes first*.

> **Status: design phase.** No stack, architecture or feature set is committed yet.
> See *Design — open questions* below.

## Purpose

`prisme` interconnects **Notion** (thinking) with **Todoist** (doing) and turns that
combined picture into priorities, progress and review:

- rank work against the goals and deadlines actually set
- KPIs on progress versus those goals and deadlines
- a home for the weekly review (and later the monthly / quarterly ones)

The name: a prism decomposes one beam of white light into an ordered spectrum —
one fuzzy goal into a ranked, schedulable sequence of work.

## Design — open questions

Deliberately unresolved. To be worked through before any scaffolding lands.

1. **Direction of truth** — is Todoist the execution system of record with Notion as the
   thinking layer, or is the sync genuinely bidirectional? Conflict resolution is exactly
   where the existing open-source syncers break down.
2. **What gets scored** — Todoist tasks, Notion items, or both? And scored *against what*:
   a Notion OKR, a project, a deadline, or a blend?
3. **Scoring model** — one formula (RICE / ICE / WSJF), a weightable blend, or Eisenhower
   quadrants layered over a numeric score?
4. **Sync trigger** — cron poll, webhooks, or both? Latency versus API quota.
5. **Interface** — read-only dashboard, or does it also *write back* (re-ordered priorities
   into Todoist, review notes into Notion)?
6. **Review ritual** — what does the weekly review actually need to show, and where does
   the artefact live afterwards (a Notion page, or in-app only)?
7. **Stack** — deliberately undecided.
8. **Deployment** — homelab Kubernetes alongside the other org services?

## Context

Prior-art research (sync tools, calendar-first planners, prioritization frameworks) is
summarised in the repository history rather than duplicated here; the conclusion was that
no existing product owns the loop of *Notion goals → ranked Todoist work → KPI →
weekly review*.

## Related

- `vchatela-org/shared-workflows` — reusable GitHub Actions (Docker build / push / scan to
  Harbor). Once the stack is chosen, CI should call
  `vchatela-org/shared-workflows/.github/workflows/docker-build-push-harbor.yml@v1`.

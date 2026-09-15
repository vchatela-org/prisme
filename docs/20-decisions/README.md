# Architecture decision records

One file per decision. A record is written when a choice would otherwise have to be re-derived — or
re-argued — later.

**An Accepted ADR is binding.** If your work requires contradicting one, write a new ADR proposing
the supersession and stop for review. Implementing against a decided ADR silently is worse than
being blocked, because the reasoning is lost and the contradiction is discovered by a bug.

Open questions live in [`OPEN.md`](OPEN.md).

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-prisme-owns-the-model.md) | prisme owns the prioritization model | Accepted |
| [0002](0002-typescript-monorepo.md) | TypeScript monorepo | Accepted |
| [0003](0003-deadline-prioritizes-due-plans.md) | Deadlines prioritize, due dates plan | Accepted |
| [0004](0004-score-initiatives-not-tasks.md) | Score initiatives, never tasks | Accepted |
| [0005](0005-allocate-before-ranking.md) | Allocate capacity before ranking | Accepted |
| [0006](0006-pluggable-scoring.md) | Scoring methods are pluggable and versioned | Accepted |
| [0007](0007-year-scoped-weights.md) | Area weights are year-scoped | Accepted |
| [0008](0008-field-level-ownership.md) | Ownership is per field, never per object | Accepted |
| [0009](0009-level-triggered-reconciliation.md) | Level-triggered reconciliation, not event handling | Accepted |
| [0010](0010-adopt-never-creates.md) | Adopting existing work can never create duplicates | Accepted |
| [0011](0011-optional-narrative-page.md) | Narrative page is optional, created on demand | Accepted |
| [0012](0012-key-results-first-class.md) | Key results are first-class and anchored | Accepted |
| [0013](0013-self-assessed-progress.md) | Objective progress is self-assessed | Accepted |
| [0014](0014-lanes-outside-the-backlog.md) | Run, Signals and Rituals are lanes | Accepted |
| [0015](0015-auth-split-by-caller.md) | Identity provider for humans, scoped tokens for agents | Accepted |
| [0016](0016-document-tool-owns-processes.md) | The document tool owns process pages outright | Accepted |
| [0017](0017-public-repository.md) | Public repository, impersonal content rule | Accepted |
| [0018](0018-state-in-postgres.md) | All state lives in PostgreSQL | Accepted |
| [0019](0019-project-as-optional-container.md) | Project is an optional container | Accepted |
| [0020](0020-sync-cadence.md) | Sync every 15 minutes, daytime window, force button | Accepted |
| [0021](0021-verified-forward-auth-assertion.md) | Trust a verified assertion, never an identity header | Accepted |
| [0022](0022-backups-belong-to-the-deployment-repository.md) | Database backups belong to the deployment repository | Accepted |
| [0023](0023-node-26-toolchain-baseline.md) | Node 26 is the toolchain baseline, pnpm installed from npm | Accepted |

## Format

```markdown
# ADR-NNNN · Title in the imperative

**Status:** Proposed | Accepted | Superseded by ADR-MMMM · YYYY-MM-DD

## Context      what forced a choice, and what constrained it
## Decision     what was chosen, stated so it can be checked against code
## Consequences what follows — including the costs, stated honestly
## Alternatives what else was considered, and why it lost
```

Write the **Alternatives** section properly. A record without it reads as inevitable, and the next
person — who has a good reason to revisit it — cannot tell whether their idea was already
considered and rejected, or simply never occurred to anyone.

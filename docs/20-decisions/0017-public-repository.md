# ADR-0017 · Public repository, with a hard impersonal-content rule

**Status:** Accepted · 2026-09-15

## Context

prisme manages deeply personal data — health, relationships, finances, years of planning history.
The repository could be private, which is the cautious default.

But a public repository gets GitHub's security tooling for free, including **secret scanning with
push protection**, which is the one control that blocks a credential *before* it reaches history
rather than reporting it afterwards. On a private repository those require paid licensing, leaving
only third-party equivalents that run after the fact.

The tension is real: the strongest credential protection comes with the worst consequence for a
content leak.

## Decision

**The repository is public, and it documents a product rather than its owner.**

| Public | Private |
|---|---|
| The model: "N areas, weights per year" | Which areas, and their weights |
| Entity and field definitions | Any real objective, project or task |
| Environment variable **names** | Values, secret paths, hostnames |
| The **schema shape** expected of external tools | Page IDs, database IDs, workspace URLs |
| Synthetic fixtures | Anything from the live instance |

Enforced by: instance data living outside git entirely; a synthetic fixture set as the only data
permitted in docs, tests and examples; a privacy deny-list scan in CI and pre-commit; gitleaks;
and the journal rule. Full rules in [`17-privacy.md`](../17-privacy.md).

## Consequences

- Push protection, CodeQL, secret scanning, Dependabot and dependency review, all free.
- External databases are referenced by **role key** rather than name — better engineering anyway,
  since the application then works against any workspace rather than one.
- Every contributor, human or agent, carries a permanent obligation. The rule is repeated in every
  workstream brief because the riskiest moment is debugging against live data.
- Public git history is permanent. A content leak is not fixed by deleting a file.
- A pre-publication sweep over the **entire history** is required before going public, and it is
  cheap only while the history is short.

## Alternatives

**Private repository.** No content risk at all. Rejected: loses push protection — the highest-value
control — precisely for a codebase holding tokens to an entire personal workspace.

**Public code, private documentation.** Rejected: splits the context agents need across two places
and gets stale immediately.

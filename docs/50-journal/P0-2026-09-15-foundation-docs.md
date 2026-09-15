# P0 · 2026-09-15 · Foundation documentation

**Author:** Claude (Opus 5), with the project owner · **Outcome:** complete

## What was done

Wrote the P0 deliverable: the domain model, the field-level ownership matrix, the scoring contract,
the adoption and migration design, the threat model, the runtime contract, the sync design, the
privacy rules, 20 ADRs, the roadmap, 16 workstream briefs, the synthetic fixture set, and the
repository structure that gives agents their context.

No application code. The model is the gate; code written against an unfrozen model is code written
twice.

## Decisions taken

Twenty ADRs, indexed in [`../20-decisions/README.md`](../20-decisions/README.md). The consequential
ones:

- **prisme owns the model** (ADR-0001). The predecessor encoded it in the document tool's relations
  and formulas, which worked for one project and broke at N.
- **Scoring is a plugin** (ADR-0006). The formula in use beforehand was known-flawed; replacing one
  formula with another would repeat the mistake in a year.
- **Weights are year-scoped** (ADR-0007). A weight adjustable in the moment gets adjusted to match
  what already happened, which destroys the only reference point the system has.
- **Ownership is per field, never per object** (ADR-0008). Object-level ownership was the ambiguity
  that broke the previous attempt.
- **Adoption cannot create duplicates** (ADR-0010), enforced by four independent guards rather than
  by care.
- **Public repository** (ADR-0017), traded for push protection, and paid for with a hard
  impersonal-content rule.

## Surprises

- **`Project` was missing from the model.** The original design was Area → Initiative, which cannot
  represent a large multi-month effort with its own structure in both tools. Added as an optional
  container (ADR-0019).
- **Run's measurement already existed.** Recurring upkeep needed a duration per task, and the
  document tool's process pages already carry declared duration and frequency. That turned an
  open question into a join, with no new data entry and no new ownership (ADR-0016).
- **`docs/00-vision.md` initially contradicted the privacy rule**, by planning to include the
  concrete diagnosis figures that motivated the project. Resolved: the vision states the general
  failure mechanism; the specific measurements stay out of git.
- **The worked scoring example did not reproduce exactly** when derived from rounded observed
  shares — two rows differed in the second decimal. Fixed by making the fixture pin *balance
  factors* as exact inputs, with observed shares shown as rounded derivations. This is also more
  faithful to the architecture: capacity computation and scoring are separate functions.

## Verification against the live cluster

Ran the runtime contract against the real deployment target rather than assuming it. Three
assumptions in `15-runtime.md` were wrong, all cheap to fix now and expensive after images exist:

- **Secret delivery.** Assumed per-key `<NAME>_FILE` mounts. Actual: a Vault agent init container
  renders a template to a **single env file**. Added `PRISME_ENV_FILE` as the primary path, with a
  documented precedence order.
- **Identity.** ADR-0015 assumed per-application OIDC. The cluster's established pattern is
  **forward-auth via a proxy provider** — a different trust model, since it makes safety depend on
  prisme being unreachable except through the proxy. Raised as **OQ-9**; W14 is marked blocked on it.
- **Database.** Assumed an operator might be available. Actual: a plain Helm-chart PostgreSQL, no
  operator. So: single instance, no managed failover, and **backups are the deployment repository's
  responsibility** — which matters because prisme is a system of record.

Also confirmed: k3s, Gateway API `HTTPRoute` for ingress, and cluster access from this host.

Two bugs found by verifying rather than trusting:

- **`.gitignore` comments silently disabled every privacy pattern.** A `#` only starts a comment at
  the *start* of a line; trailing comments become part of the pattern, so `seed/` was not ignored at
  all. Found by testing `git check-ignore` on each protected path instead of reading the file.
- **The privacy deny-list's hostname pattern over-matched**, flagging filename globs like
  `*.local.*`. Narrowed to host position.

Both were caught because the gates were *tested*, including the negative case — a planted violation
must fail the build, and it does.

## Follow-ups

- **OQ-9 blocks W14** and must be closed before wave 2. It is the only open question with a
  near-term blocker; OQ-1 and OQ-2 block P2, and the rest are deferred by choice.
- **Before the repository goes public**: the history scan is wired into CI and passes today, but run
  the full pre-publication sweep in [`../17-privacy.md`](../17-privacy.md#pre-publication-sweep) —
  including reading commit messages, which are public too.
- **Still to confirm for W00**: the exact rendered env-file path and format, and whether the registry
  pull secret is namespace-scoped.
- **Confirm database backups exist** before the first outward `apply`. prisme is a system of record
  and the cluster has no database operator doing this automatically.
- **Wave 4 will conflict**: W09, W10, W11 and W13 all touch `apps/web`. Serialize them, or give each
  a disjoint route group over an already-merged `packages/ui`.

## Specs touched

All of `docs/` created in this run. `README.md` rewritten — its eight original open questions are
now answered or superseded. `.gitignore` extended to cover instance data, not only secrets.

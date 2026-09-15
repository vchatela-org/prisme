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

## Follow-ups

- **Eight open questions** in [`../20-decisions/OPEN.md`](../20-decisions/OPEN.md). None blocks P0;
  OQ-1 (can a project span areas) and OQ-2 (WIP limits) block P2.
- **Before the repository goes public**: run gitleaks and the privacy deny-list over the *entire*
  history, not just the working tree. Cheap now, while the history is two commits.
- **Verify the runtime contract** in [`../15-runtime.md`](../15-runtime.md) against what the
  deployment repository can actually supply — particularly file-mounted secrets and the OIDC client
  registration — before W00 finalises the Dockerfiles.
- **Wave 4 will conflict**: W09, W10, W11 and W13 all touch `apps/web`. Serialize them, or give each
  a disjoint route group over an already-merged `packages/ui`.

## Specs touched

All of `docs/` created in this run. `README.md` rewritten — its eight original open questions are
now answered or superseded. `.gitignore` extended to cover instance data, not only secrets.

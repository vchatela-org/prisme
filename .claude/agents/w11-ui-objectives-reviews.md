---
name: w11-ui-objectives-reviews
description: Builds the Objectives, Key Results and Review wizard screens - where decisions actually get made. Wave 4, depends on W05 and W07.
---

Execute workstream **W11 · UI — Objectives, Key Results and Reviews**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W11-ui-objectives-reviews.md` — your contract
3. ADR-0012 and ADR-0013 in `docs/20-decisions/`
4. `apps/web/CLAUDE.md`
5. `docs/50-journal/INDEX.md`

⚠ **Wave 4 conflict risk.** W09, W10 and W13 run alongside you. Stay inside `(objectives)` and
`(review)`. The Year Review weight-entry screen belongs to W09, not you.

The review wizard is the highest-value screen in prisme and the easiest to get wrong.

- **Every step must bring its own data.** A checklist that merely lists steps is no better than the
  paper version — the whole benefit is not having to go and look something up.
- **Resumability is not optional.** Reviews get interrupted, and losing one twice means it stops
  happening.
- **Never average or reconcile the two progress numbers.** Self-assessed and computed measure
  different things, and the gap between them is the finding (ADR-0013). Show both, explain the
  divergence.
- Orphan detection runs both ways: an objective with no initiative, and an initiative serving no
  objective. Neither is automatically wrong.

The artefact a review produces should be worth reading a month later.

Fixture data only. Finish on a branch (`ws/<id>`): the journal entry and `STATUS.md` row first, then
a pull request filled in from `.github/pull_request_template.md`. **Opening it is not the end: read
its checks back until every one reports green** — a push resets that, and a check that is queued, in
progress or not yet reported is not green. Fix what is red and push again; never weaken a check to
get past it. **Do not merge it yourself** — a human merges.

Rules, and what to do at each ending: `docs/40-workstreams/README.md#read-the-checks-back`.

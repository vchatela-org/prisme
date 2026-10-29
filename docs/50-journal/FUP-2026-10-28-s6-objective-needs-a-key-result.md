# FUP · 2026-10-28 · S6: an objective with no key result says why nothing can serve it

**Agent:** Claude · **Duration:** one run · **PR:** [#191](https://github.com/vchatela-org/prisme/pull/191) · **Outcome:** the rule that work serves
key results, not objectives, is stated where it bites — on the objective, in the Objectives list
and in the monthly *find orphans* step — and each offers *add a key result*. S6 is closed.

## What was found first

The screens already noticed the case: the objective's page had *Nothing measures this objective
yet*, the Objectives list said *no key results*, and the orphans step listed the objective. None of
them said **why** that meant nothing could serve it, and the orphans step, where the finding is
read, linked only to the objective's page with no hint of what to do there.

## What was done

- `orphanReason` and `addKeyResultHref` in `apps/web/src/lib/objectives-view.ts` (+ tests).
- The objective's page: the empty state says work serves key results, never the objective, so
  nothing can count toward it until it has one — and that this is the rule. Its *Add a key result*
  section has an anchor (`ADD_KEY_RESULT_ANCHOR`).
- The Objectives list: an orphan's line and a card with no key result link to that anchor.
- The monthly *find orphans* step: each objective says *no key result yet — add one* (to the
  anchor) or *nothing linked to its key results*, and the footnote states the rule.

## Decisions taken

- **The rule stays.** The finding asked whether it is right; the model's answer — an objective you
  cannot measure is a wish — is written into [`10-model.md`](../10-model.md) §7 rather than
  changed. No initiative can serve an objective directly.
- **A link, not an inline form, from the orphans step.** Writing a key result needs a statement, a
  target and a unit; the objective's page already has the form and the context for it.
- **No API change.** Everything needed was already in the objectives list response.

## Checks run locally

Node 24.21.0: `apps/web` typecheck, `objectives-view.test.ts` (41), eslint and prettier on the
changed files, the privacy scan with the local supplement; the whole `unit` project before pushing.

## Not done

- Nothing creates a key result for an adopted objective automatically; that would invent a measure.

## Specs touched

- `docs/10-model.md` §7, `docs/18-user-guide.md` §4 (monthly), `docs/19-how-it-works.md` S6.

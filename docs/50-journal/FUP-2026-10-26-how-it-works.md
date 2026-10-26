# FUP · 2026-10-26 · How prisme works, and where the model is thin

**Agent:** Claude · **Duration:** one run · **PR:** this entry's own · **Outcome:** a new spec-adjacent
document, `docs/19-how-it-works.md`; no code changed

The owner, using a live instance, found the product hard to hold in their head: many kinds of
object, several ways in, and no single place saying which thing should become which object. They
asked for the functional model written down — how the product approaches things, not how their
instance is used — so that it can be iterated on.

## What was done

- `docs/19-how-it-works.md`: the idea in one paragraph; the three tools' jobs; the twelve objects in
  five families with a *which object is it?* guide; the five doors in, with the adoption queue's
  *what becomes what*; the core loop (allocate → measure → rank → select → push) with its formulas
  and a synthetic example; sync and the intent channel; an initiative's lifecycle; what each review
  cadence asks and what prisme prepares for each step; how to read the numbers; and fourteen
  structural findings (S1–S14), each with a direction to explore.
- Linked from `README.md`'s document table and from the layout block in `CLAUDE.md`.

## Decisions taken

- **A new document rather than a rewrite of the user guide.** The guide is organised by screen and
  answers *what do I click*; the specs are organised by entity and answer *what is the rule*.
  Neither answers *how does it fit together*, and folding that into either would make it worse at
  its own job.
- **Findings are stated as properties of the product, never of the instance.** The walkthrough
  that produced them ran against real data; nothing from it — no title, count, area or proportion —
  is in the document or here. The owner's own usage notes are kept outside git.
- **Every finding was checked against the code, not only the specs.** Two first drafts were wrong
  in a way the specs would not have caught: the `prisme` label is applied by the reconciler as an
  automatic adoption (`planIntentChannel`), not proposed in the queue; and a score is stored by
  the sync bar's re-score as well as the review step.
- **Findings are not decisions.** None is implemented or turned into an ADR here. Several touch
  accepted ADRs (0010, 0016, 0029, 0033) or the frozen cadence map, and each deserves its own
  discussion.

## Surprises

- `12-scoring.md` §4 says Signals count toward capacity; `10-model.md` §9 and the attribution code
  say they do not (S14). Recorded as a finding rather than corrected here, since which one is right
  is a decision.
- `POST /rituals/:id/adherence` exists and is reachable from no screen (S2).

## Follow-ups

| Item | Owner |
|---|---|
| Triage S1–S14: which become ADRs, which are copy, which are dropped | the owner |
| Correct `12-scoring.md` §4 on Signals, or decide otherwise (S14) | whoever takes S14 |

## Specs touched

- None changed. `docs/19-how-it-works.md` is new and cites the specs rather than restating their
  rules.

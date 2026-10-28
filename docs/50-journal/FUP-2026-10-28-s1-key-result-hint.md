# FUP · 2026-10-28 · S1, second step: an initiative that looks like a key result says so

**Agent:** Claude · **Duration:** one run · **PR:** [#182](https://github.com/vchatela-org/prisme/pull/182) · **Outcome:** open
initiatives with a deadline more than six weeks out, or an open objective's title in their area, are
marked *Looks like a key result* on the Inbox and their page; S1's second *Explore* item is done

The first step (#180) taught the adoption scan to read a task kept as a key result. It cannot reach
the commonest path: the `prisme` label, which the reconciler turns into an `inbox` initiative on its
next pass, with no queue row. This step marks the result where it lands.

## What was done

- `keyResultHints` in `@prisme/domain` (`entities/key-result-hint.ts`): two hints, in a fixed order.
  - `long_horizon`: the deadline is more than 42 days after the day the work can start, which is
    today or a later `earliest_start`.
  - `objective_title`: the normalised title equals an open objective's (draft or active) in the
    same area.
  Only open initiatives are hinted: not `review`, `done` or `dropped`.
- The title normaliser moved from `apps/sync/src/adoption/normalise.ts` to `@prisme/domain`
  (`entities/title.ts`, as `normaliseTitle` and `exactTitleForm`), with its tests. Adoption
  re-exports it under the old names. One implementation, so the queue and the hint cannot disagree
  about whether two titles match.
- The API: the ranking snapshot reads every objective. `keyResultHints` is a new field on the
  initiative DTO, so it appears everywhere an initiative is returned, including `/inbox`, and on
  the MCP initiative brief.
- The web: *Looks like a key result*, with its reasons written out, on each Inbox row and on the
  initiative's page.

## Decisions taken

- **A hint, never a decision.** Nothing reads it: no score, slot, rank or status changes. An
  initiative can legitimately have a far deadline. The screen asks the question, and the answer, if
  it is one, is the next step's *convert to key result*.
- **Six weeks counts from when the work can start,** not from when the initiative was created. A
  later `earliest_start` is a plan, and the deadline after it is what the size claim is about.
- **On the DTO, not on a screen-specific shape.** `sizedForNow` set the precedent of a derived
  check carried with the initiative. Every surface that shows an initiative can show the hint
  without a second request.
- **The reasons are written beside the badge, never only in a tooltip.** That follows the tooltip
  primitive's own rule.

## Not done

- *Convert to key result* (S1's third item), next.
- The hint is not shown on Backlog or Focus rows yet. The field is there, so this is copy and
  layout work only.

## Checks run locally

Node 24.21.0 (the repo pins 26; CI runs that): `pnpm typecheck`; `@prisme/domain` entity tests;
the `apps/sync` adoption suite; `apps/api` unit tests and the initiatives integration block against
`prisme_test`; `apps/web` lib tests; eslint and prettier on the changed files; the privacy scan with
the local supplement.

## Specs touched

- `docs/10-model.md` §5, `docs/18-user-guide.md` (*Inbox*, *An initiative's page*),
  `docs/19-how-it-works.md` §4 and S1.

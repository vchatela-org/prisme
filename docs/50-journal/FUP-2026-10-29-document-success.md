# FUP · 2026-10-29 · The document tool's success figure is read and shown, never owned

**Agent:** Claude · **Duration:** one run, resumed after a rate limit · **PR:** this branch's pull request ·
**Outcome:** [ADR-0042](../20-decisions/0042-the-document-tools-success-figure-is-shown-not-owned.md).
The objectives store's success percentage is read once per pass and shown beside the status when an
objective is judged. It is never written, never a score, and it changes no status. Migration 0025 adds
the chosen column and the figure. The owner's question about holding an objective open past its window
is recorded as open, not decided.

## What was found

- **Three fields in the objectives store and one in the takeaways store had no owner.** The success
  percentage, the preparation status and the legacy task identifier on the objectives store, and the
  WSJF, priority and workload columns on the takeaways store, were in neither the ownership matrix nor
  the code. That is a Rule 2 gap: a field with an unclear owner is raised, not guessed at.
- **The percentage competed with prisme's own measures.** On the owner's instance an objective could
  read fully achieved in the document tool and `active` in prisme. Under ADR-0037 it would then be
  closed `missed` when its window ended.

## What was decided

- The figure belongs to the document tool. prisme reads it, stores it on the objective, and shows it
  when the owner judges the objective: *the document says 100% — mark met?*. During the period it is
  shown and nothing is asked.
- It is off until a number property is chosen as the store's success column on Settings → Notion. The
  chosen property's format says how its values read: a percent property is a fraction, a plain number
  is already a percentage, and any other format is refused rather than guessed at.
- The takeaways' own weighting columns are the document tool's and unread. Scoring is prisme's.

## A change of scope, and why it is recorded

The first version of this work went further than the decision above. It made an objective whose page
read 100% at the end of its window **stay open** rather than close `missed`. That changes ADR-0037's
window rule, which is Accepted. [CLAUDE.md](../../CLAUDE.md) §5.7 requires an owner decision before an
Accepted ADR is superseded, and the owner had asked for the review's suggested fixes, whose suggested
fix for the figure is a display at judgement time. The window change was reverted before merge. The
window code, `packages/domain`'s window steps and the sync windows pass are back to their state on
`main`. The figure's helpers now live in their own domain module (`document-success.ts`), which holds
no window logic.

The reverted version had been written by a workstream agent that stopped at a rate limit. It could not
be resumed, so its uncommitted work was finished and corrected in place rather than re-run from its
brief. Nothing of it reached a remote.

## Open question for the owner

**Should an objective the document marks 100% be held open past its window, rather than closed
`missed`?** Holding it open leaves a judgement waiting, with a reason on screen. Closing it `met`
automatically would be a judgement nobody made, so that is not on the table. Until the owner answers,
the Objectives screen says *the document says it was met; judge it by …, or it closes as missed*.

## What was done

- **Domain.** `document-success.ts`: the 100% threshold, `documentSaysMet`, the format-to-scale rule,
  and the percentage normalisation (rounded, with a refusal for a missing, non-finite or negative
  value). Five unit tests.
- **Sync.** `objective-success/`: the success read, once per pass, level-triggered. It writes the figure
  for every objective linked to a page, `null` included, and clears the figures when the column is
  given up. It runs under `plan` without writing. A failed read leaves the last stored figure. Its
  place in the pass is the same as before; nothing hands it to the windows.
- **Migration 0025.** `role_binding.success_property` and `number_properties` (the last check's
  property list, with formats); `objective.document_success` and `document_success_read_at`, with a
  check that a figure always has its read time. The reversal is in the migration header and was
  rehearsed against a throwaway database.
- **API.** The objective DTO carries `documentSuccess`, `documentSuccessReadAt` and `documentSaysMet`.
  Settings → Notion offers a choice of number properties, refusing any format that is not a success
  figure. The Objectives screen shows the figure beside the status.
- **Ownership.** Three rows in `11-ownership.md` §6.

## Tests

- Domain: 5 new unit tests for the figure helpers; the window tests are the `main` versions, unchanged.
- Sync and API unit suites: green (503 and 215).
- Integration project, against a throwaway database at migration 0025: 416 passed, including the
  settings choice of a success property and the objective DTO's figure fields.
- Web: the objective window line, with and without a figure. 49 tests.

## Not done

- The owner's question above. This branch does not change ADR-0037.
- The objectives store's preparation status and legacy task identifier are not read. The identifier is
  part of the question of which objective tasks are bound, which is separate work.
- No MCP tool exposes the figure. Agents reading objectives get it through the REST DTO only when the
  MCP read is next revised.

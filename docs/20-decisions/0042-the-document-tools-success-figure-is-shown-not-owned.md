# ADR-0042 · The document tool's success figure is read and shown, never owned

**Status:** Accepted · 2026-10-29 · the owner asked for the suggested fixes of the 2026-10-29 alignment
review to be applied. The review offered two answers for the objectives store's figure — display it,
or retire it — and this decision takes the first: **display**. One question it raises is left open
for the owner, in *Open question* below.

## Context

The document tool's objectives store carries, per objective, a **success percentage**, a preparation
status and a legacy task identifier. None of them is in [`11-ownership.md`](../11-ownership.md) §6,
which is a Rule 2 gap: every field has exactly one owner, and these had none.

The percentage competes with prisme's own measures:

- an objective can read **100%** in the document tool while prisme holds it `active` and its key
  results at a self-assessed progress well below that;
- under [ADR-0037](0037-an-objective-follows-its-window.md) an objective still open after its review
  window is closed `missed`, whatever its page says. On the owner's instance that is a page reading
  100% closed as missed.

Two answers would resolve the competition: make the figure prisme's, or make it the document tool's
and show it. prisme's judgement of an objective is `met` or `missed`, and [ADR-0013](0013-self-assessed-progress.md)
keeps that judgement human. A figure that prisme copied in and then acted on would be a second
judgement made by a machine.

## Decision

1. **The success figure is the document tool's, read-only for prisme.** prisme reads it once per pass
   and stores it on the objective (`objective.document_success`, with when it was read). It is never
   written outward, never a score, and nothing in `packages/domain` ranks, balances or dates by it.
2. **It is shown where a person judges.** Beside the status on Objectives, the figure appears as
   *The document says 100%*. When the document reads met and the objective's period is over, the
   prompt is *the document says it was met — mark met?*, a question to answer with the status
   buttons. During the period the figure is shown and nothing is asked: judging early is a person's
   move.
3. **It changes no status.** An objective is still closed by its window exactly as
   [ADR-0037](0037-an-objective-follows-its-window.md) says. The figure does not hold an objective
   open, and it does not close one `met`.
4. **It is off unless chosen.** Nothing is read until a number property is chosen as the store's
   success column on Settings → Notion. The chosen property's **format** decides how its values read:
   a `percent` property is a fraction (1 is 100%), a `number` is already a percentage, and any other
   format — a currency, above all — is refused rather than guessed at.
5. **Its ownership is in the matrix.** [`11-ownership.md`](../11-ownership.md) §6 names the figure, the
   store's preparation status and its legacy task identifier as the document tool's, read-only, and
   the takeaways store's own weighting columns as the document tool's and **unread**.

## Open question

**Should an objective the document marks 100% be held open past its window, rather than closed
`missed`?** ADR-0037 closes it; a page that says it was met would be contradicted by that. The two
answers are not symmetric: holding it open leaves a judgement waiting with a reason on screen, and
closing it `met` automatically would be a judgement nobody made. This ADR does **not** make that
change, because [CLAUDE.md](../../CLAUDE.md) §5.7 requires an owner decision before an Accepted ADR is
superseded, and ADR-0037 is Accepted. Until the owner decides, the window closes such an objective
as written, and the Objectives screen says so in the period-over line: *the document says it was met;
judge it by …, or it closes as missed*.

## Consequences

- An objective the document marks 100% still closes `missed` on its window's last day if nobody has
  judged it. The prompt is there beforehand, and the event log records the window as the reason.
- The figure is refreshed every pass and is `null` when the property is unset, when the page is gone
  or archived, or when the page holds no number. A failed read leaves the last stored figure in place.
- The objectives store's *preparation status* and *legacy task identifier* are not read. The task
  identifier is the subject of a separate question (the four unbound objective tasks), not of this
  ADR.

## Alternatives

- **Retire the figure.** Simplest, and the owner's other option in the review. Not taken: the figure
  is useful at judgement time, and retiring it loses information that exists only in the document.
- **Make the figure prisme's status.** Rejected: it would be a second judgement made by a machine,
  against ADR-0013.
- **Hold an objective open while the figure reads 100%.** Not taken here. It supersedes ADR-0037's
  window rule and is the owner's decision, recorded above as the open question.

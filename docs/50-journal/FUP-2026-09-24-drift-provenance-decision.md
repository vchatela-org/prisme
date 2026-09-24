# FUP · 2026-09-24 · The drift alert's missing provenance, decided

**Agent:** Claude · **Duration:** part of a session · **PR** this branch · **Outcome:** decided, not built

**This entry records a decision, not a change.** The sync-metrics row stays 🟡 and this branch touches
no code. It exists because the decision was made and implementing it is a separate piece of work — and
a decision that lives only in a conversation is indistinguishable from no decision at all, which is
the lesson `docs/20-decisions/OPEN.md` is written around.

## The row, and which of its three parts is undecided

*"The deployment's drift alert was removed rather than repaired, and `last_drift_full` is recorded
with no reader; `apps/sync/src/main.ts` still sets in-process gauges a CronJob pod can never have
scraped."*

Two parts are work anyone can pick up: the deployment repository's alert rule, and a tidy-up of
gauges that are harmless because that process is never scraped. The third is a design question, and it
is the one that blocked the other two.

## The question

`docs/15-runtime.md` §5 specifies **one** alert on `prisme_sync_drift_objects`: *"Above 0 on two
consecutive daily full passes."*

The gauge as it stands holds the most recent pass's drift, and a pass is full once a day and
incremental every fifteen minutes. `sync_run_state` records whether that most recent measurement came
from a full pass — that is what `last_drift_full` is — and **nothing publishes it**. So the rule in §5
cannot be written, and the alternative an operator would reach for, `min_over_time(gauge[48h]) > 0`,
answers a different question: *has any pass seen drift recently*, which is mostly the incremental
ones and fires sooner and more often than the spec asks.

## The decision

**The last _full_ pass's drift gets its own column, and its own gauge.**

- A migration adds the full pass's own measurement beside `last_drift_objects`, which keeps meaning
  *the most recent pass of either kind*.
- The API's refresher publishes it as **`prisme_sync_drift_full_objects`**, absent until a full pass
  has been recorded — absent, not zero, for the reason #44 is built on.
- §5 gains a row for it, and its alert is exactly the sentence already written there:
  `min_over_time(prisme_sync_drift_full_objects[48h]) > 0`. Every daily full pass in the window
  reported drift, which is what *two consecutive* means at a daily cadence.
- The deployment's rule is restored against that gauge, and `last_drift_full` has a reader at last —
  the refresher, which is what turns it into the new gauge's absence or presence.

**Additive, on purpose.** A new column and a new metric leave the existing gauge, its help text and
any expression already written against it exactly as they are. W09's precedent applies: the second
half of a fix should not make the first half's consumers think about it.

**Labelling the existing gauge was considered and rejected.** `prisme_sync_drift_objects{pass="full"}`
needs no migration and no new metric, and unlabelled selectors would keep matching. But the singleton
row holds one pass at a time, so that series carries samples only in the fifteen minutes after a full
pass before an incremental pass overwrites it — and `min_over_time(...{pass="full"}[48h])` would then
mean *the last full pass*, not *two consecutive*. A cheaper expression that quietly answers a weaker
question is the failure this repository's alert rules already have one example of.

**Changing §5's wording was considered and rejected.** Rewriting the rule to *"sustained non-zero"*
and alerting on the existing gauge would need no work at all. It was rejected because the rule is
**right**: the daily full pass is what compares the incremental stream against the full view, and it
is the only measurement that can say the incremental path is broken while appearing to work. What was
missing was the expression, not the intent.

**`last_drift_full` is not made vestigial.** With a dedicated full-pass value it is no longer the only
place the provenance lives, but it still says which kind produced the *latest* number, which is what
a reader of the gauge needs when both are on a dashboard.

## What this branch does not do

It does not add the column, the gauge, the spec row, the deployment's rule, or the tests. It does not
touch `apps/sync/src/main.ts`'s in-process gauges. The row stays 🟡 with this entry linked from its
state cell, so the next person to open it finds the decision rather than re-deriving it.

# 12 · Scoring

**Scoring is a plugin.** The first method shipped is not the last, and swapping methods must never
require a migration.

All examples use the synthetic dataset in [`fixtures/`](../fixtures/) — see
[`17-privacy.md`](17-privacy.md).

---

## 1. Why pluggable

The obvious approach — pick a formula, put its result in a column, sort by it — fails in three ways
that are all expensive to undo later:

1. **The first formula is always wrong.** A prioritization formula encodes judgement, and judgement
   improves with evidence. The one shipped in v1 will be revised, and revising it should not mean
   rewriting queries.
2. **You cannot evaluate a change you cannot compare.** Switching formulas blind means discovering
   afterwards that the new ranking is worse. Two methods must be able to run side by side.
3. **A score column loses history.** Knowing an item ranks 4th today is much less useful than
   knowing it ranked 1st for six weeks and was never picked — which is a fact about you, not about
   the item.

## 2. The contract

```ts
interface ScoringMethod {
  readonly id: string;        // 'wsjf-balanced'
  readonly version: number;   // bump on ANY behaviour change
  readonly paramsSchema: ZodSchema;

  score(input: ScoringInput, params: Params): ScoringResult;
}

interface ScoringInput {
  initiative: Initiative;          // value, timeCriticality, risk, size, deadline, status…
  area: { key, targetShare, actualShare, balanceFactor };
  now: Date;                       // injected — never call the clock inside a method
}

interface ScoringResult {
  score: number;                   // higher ranks first
  factors: Record<string, number>; // every intermediate, for explainability
  explain: string;                 // one human sentence
}
```

Three hard rules:

- **Pure.** No I/O, no clock, no randomness. `now` is an input. Same inputs always produce the same
  output, which is what makes a method testable and a historical score reproducible.
- **Versioned.** Any change to behaviour bumps `version`. Historical scores stay attributable to the
  method that produced them.
- **Explainable.** `factors` and `explain` are not optional. A ranking you cannot interrogate is a
  ranking you will stop trusting the first time it surprises you — and then the whole system is
  decoration.

### Storage

```sql
initiative_score (
  initiative_id, method_id, method_version,
  score, factors jsonb, explain text,
  computed_at, is_active_method boolean
)
```

**Append-only. Never a column on `initiative`.**

> **Invariant.** No code outside `packages/domain/scoring` may read `wsjf` or any method-specific
> field. Everything reads the active method's score through the registry. A `wsjf` column appearing
> anywhere is a bug, not a shortcut.

### Active and shadow methods

One method is **active** — it determines ordering everywhere. Any number run in **shadow**: computed
and stored, never used for ordering. The UI can diff two rankings, so a method change is evaluated
on real data before it takes effect.

Parameters are **data**, not constants: stored per method, editable in settings, versioned
alongside. Tuning a threshold is not a deploy.

---

## 3. `wsjf-balanced` — the method shipped first

A cost-of-delay model, corrected for two known failures of naive WSJF and extended with capacity
balance.

```
cost_of_delay  =  value + time_criticality + risk
wsjf           =  cost_of_delay / size
score          =  wsjf × balance_factor
```

with

```
time_criticality  :=  13   if days_until_deadline < 14      (strictly less than)
balance_factor    =  clamp(target_share / actual_share, 0.5, 2)
```

### What each term is for

| Term | Question it answers |
|---|---|
| `value` | How much better is life once this is done? |
| `time_criticality` | How fast does that value decay? |
| `risk` | What does this de-risk or unlock? |
| `size` | How big is the *next slice*? |
| `balance_factor` | Is this area getting its agreed share of me? |

### Three corrections over naive WSJF

**Urgency is counted once.** A common formulation scores "business value" on an urgency/importance
matrix *and* adds time criticality — so urgency enters twice and always beats importance, which is
the exact opposite of what anyone actually wants from a prioritization system. Here `value` is
purely about outcome; decay lives only in `time_criticality`.

**Enough resolution to rank.** A 1–4 scale divided by a 1–4 scale yields 11 distinct values for 16
combinations: ties everywhere, and a ranking that carries almost no information. The Fibonacci scale
1·2·3·5·8·13 gives usable separation, and its non-linearity matches how people actually estimate.

**Size no longer decides everything.** Dividing by size rewards small work — which is already what
gets picked, so the formula amplifies the bias it was meant to correct. `balance_factor` is the
counterweight: an area that has been starved lifts its initiatives by up to 2×, and one that has
been over-served halves them. Size still matters; it no longer wins alone.

### What `balance_factor` deliberately does not do

It does not let a score compare *across* areas on merit. Whether a home repair outranks a
relationship goal is a values judgement, and it is settled once a year as a weight — not inferred
from a formula. Balance only asks whether each area is receiving the share already agreed.

This is the meaning of **allocate before you rank**: the budget is the values decision, the score
ranks inside it.

---

## 4. Measuring capacity

`actual_share` is the share of the last **4 weeks** of completed work attributable to each area.

| Source | Preference |
|---|---|
| Recorded duration on a completed task | Used when present — the only real measurement |
| Declared duration of the matching process page | For recurring upkeep |
| Default estimate | Fallback, configurable |

Rolling 4 weeks: long enough to survive one unusual week, short enough that the balance factor still
responds within a month.

**Run and Signals count toward capacity but never toward ranking.** Excluding upkeep from the
measurement would hide exactly the pattern the system exists to reveal — upkeep quietly consuming
the majority of discretionary time.

### Known limitation, stated plainly

Task counts and durations measure *attention routed through tasks*, not hours lived. Recurring work
is under-represented in completion history, and much of what matters in the relationship and health
areas never becomes a task at all. The balance factor is a lens, not a verdict, and areas whose work
is mostly untracked will read as starved. That is a tolerable bias — it errs toward surfacing
neglected areas — but it must not be mistaken for measurement.

---

## 5. Selecting the `now` set

Scoring ranks; selection decides. They are separate steps on purpose.

1. **In-flight work keeps its slot.** An initiative already in `now` stays until it finishes, moves
   to `waiting`, or is demoted at a review. Thrashing the top of the list every time a score shifts
   is how a system loses trust.
2. **Free slots fill from the top of the ranking**, skipping areas that already have a `now`.
3. **Work in progress is capped** — see OQ-2 in [`20-decisions/OPEN.md`](20-decisions/OPEN.md).
4. **Priority is written outward**: top 3 → highest, remaining `now` → high, `next` anchors →
   medium, everything else → lowest.

The per-area cap is what keeps one busy area from occupying every slot — the same reasoning as the
balance factor, applied to selection instead of ranking.

---

## 6. Worked example

Synthetic data. Six areas; `health` is starved (factor 2.0), `home` over-served (0.5).

| Initiative | Area | V | TC | R | Size | CoD | WSJF | Bal | Score | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| Half-marathon plan running | health | 8 | 2 | 5 | 3 | 15 | 5.00 | 2.0 | **10.00** | `now` · highest |
| Weekly check-in evening restarted | relationships | 8 | 2 | 5 | 3 | 15 | 5.00 | 1.8 | **9.00** | `now` · highest |
| Index allocation rebalanced | money | 8 | 3 | 8 | 5 | 19 | 3.80 | 1.2 | **4.56** | `now` · highest |
| Workshop bench finished | craft | 8 | 5 | 3 | 5 | 16 | 3.20 | 1.0 | **3.20** | `now` · high |
| Garage shelving installed | home | 8 | 5 | 5 | 8 | 18 | 2.25 | 0.5 | **1.13** | `now` · high — in flight, keeps slot |
| Draught-proofing done | home | 5 | 8 | 3 | 5 | 16 | 3.20 | 0.5 | **1.60** | `next` — area already has a `now` |
| Volunteer rota agreed | community | 8 | 2 | 3 | 8 | 13 | 1.63 | 1.2 | **1.95** | `next` — WIP full |
| Home server single sign-on | craft | 3 | 1 | 3 | 8 | 7 | 0.88 | 1.0 | **0.88** | `later` |

Two things this example is designed to show:

- **Draught-proofing outranks garage shelving on raw WSJF (3.20 vs 2.25) yet is not selected.** Its
  area already holds a `now` slot, and the one in flight keeps its place. Ranking and selection are
  different questions.
- **The home-server item scores lowest not because infrastructure work is unworthy**, but because
  it was scored honestly: low outcome value, no decay, and large. Scored honestly, it loses — which
  is the entire point, since it is the kind of work that otherwise wins by being enjoyable.

---

## 7. Candidate methods

Not scheduled. Recorded so the interface is designed against more than one implementation.

| Method | Why it might be better | Cost |
|---|---|---|
| **RICE** | Reach and confidence are explicit; confidence penalises speculative work | Reach is awkward for a single person |
| **ICE** | Fast to score, low friction | Coarse; ties return |
| **Eisenhower overlay** | Familiar; good triage | Ranks quadrants, not items |
| **Deadline feasibility** | Uses the schedule engine: rank by slack, not by guessed urgency | Needs trustworthy size estimates |
| **Revealed preference** | Fitted on what actually gets picked — describes you rather than your intentions | Descriptive, not normative; it would entrench the bias the system exists to correct, and is only useful *against* another method |

The last one is the most interesting as a **shadow** method: the gap between what you say you value
and what you demonstrably pick is a review-worthy finding on its own.

---

## 8. Testing

- **Property-based**, not example-based: monotonicity (raising `value` never lowers a score),
  bounds on `balance_factor`, determinism under repeated evaluation, invariance to unrelated fields.
- **Golden fixtures**: `fixtures/scoring/*.json` pin inputs to expected outputs. A diff in a golden
  file must be accompanied by a `version` bump — that is the guard rail that keeps versioning honest.
- **No network, no clock.** A scoring test that needs either is testing the wrong thing.

# FUP · 2026-09-24 · Every minutes chart names the record it reads

**Agent:** Claude · **Duration:** one session · **PR** [#78](https://github.com/vchatela-org/prisme/pull/78) · **Outcome:** complete

The register's row: *"`review/year` and the area detail call `minutesCaveat` without its source, so
two of the three minutes charts do not say which record they are reading"*. The row was right about
the defect and imprecise about its size — there are **five** places that draw attributed minutes, and
**three** of them were silent, not two. The count mattered, because it is what turned this from three
edits into one function.

## What was found

| Chart | Before |
|---|---|
| KPI dashboard, the area grid | `WINDOW_CAVEAT` + `minutesCaveat` + `observedSourceCaveat` |
| Areas, the area grid | `minutesCaveat` + `observedSourceCaveat` |
| Year review, the balance meters | `minutesCaveat` only |
| Year review, share over time | `WINDOW_CAVEAT` + `minutesCaveat` |
| Area detail, share over time | `WINDOW_CAVEAT` + `minutesCaveat` |

Three sentences, applied by hand in five places, and no two places carried the same subset. The
sentences themselves were already pure, exported and tested — `minutesCaveat`,
`observedSourceCaveat`, `WINDOW_CAVEAT` — so nothing was *broken* in any one of them. What was
missing was the guarantee that a chart carries the ones it needs, and that is not a property any of
the three functions can hold on its own.

**The consequence is asymmetric, which is why it was worth fixing before the functional phase.** The
record a chart reads changes the number by a lot: `capacity_week` is the backfill's imported history,
`task_mirror` is the anchor subtree — everything prisme knew about before the import, which excludes
work outside an anchor and everything completed before prisme existed. So the two charts that *did*
name their source were, in the uncovered case, the two showing the *larger* number, and the three that
were silent were the ones a reader would most reasonably assume meant the same thing.

## Decisions taken

**The three sentences are composed by one pure function, not written at the call site.**
`minutesChartCaveat({ estimatedPct, coverage, windowed })` in `apps/web/src/lib/kpi-view.ts`. The
argument for it is the defect itself: which record a chart reads is a property of the *chart*, not of
the person who wrote the screen, and "applied by hand in five places" is exactly how three of them
came to be missing it. Composing them in one place makes partial application unrepresentable rather
than merely unlikely.

**`windowed` is the one genuine difference between the charts, and it stays a parameter.** A
share-over-time chart buckets by calendar period; the balance factor the scoring method reads is a
rolling four-week window. Those two disagree, so the sentence that says so belongs on the bucketed
charts and would be *false* on the balance meters, which are already over the window. That is a real
distinction, so it is expressed rather than smoothed away.

**The test asserts the property, not the strings.** The load-bearing test iterates both `windowed`
values against both `observedSource` values and asserts each composition contains the sentence for
its own record; beside it, one test pins that the window sentence appears only on a bucketed chart,
and one that a null estimate still yields both remaining limitations. A test of a single expected
string would have passed against every one of the three broken call sites — the defect was *uneven
application*, and only an assertion over the combinations can see unevenness.

**Both fixed screens were also re-checked for the caveat sitting under a failed load**, because the
type error found one. The year review rendered its share-over-time caveat *outside* the `kpi.ok`
branch, so a reader whose history failed to load got the failure state and then a paragraph about the
buckets of a chart that was not there. It now sits inside the success branch. That is a real behaviour
change and it is the better one, but it is recorded because it was made for a type reason and kept for
a product one — the smaller reason came first.

## What was not done

**The KPI dashboard's Run-hours chart still calls `minutesCaveat` alone.** It draws the Run lane's
hours against its weekly budget, not attributed minutes, so the sentence it carries — *"This measures
attention routed through tasks, not hours lived"* — is arguably the wrong caveat for that chart rather
than a missing one. That is a question about what the chart *is*, not about this row, and it is raised
with the owner rather than recorded as an obligation this entry could hold.

## Follow-ups

None. `docs/15-runtime.md` needed no edit: it documents configuration, and nothing here changed a
variable. No ADR is touched — `docs/12-scoring.md` §4 is where the "attention routed through tasks"
limitation is stated, and it is now stated on every chart the limitation applies to.

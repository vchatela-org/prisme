# Fixtures

**Synthetic data. Entirely invented. The only dataset permitted in documentation, tests,
screenshots and API or MCP examples.**

This repository is public ([`../docs/17-privacy.md`](../docs/17-privacy.md)). Real goals, projects,
tasks, area weights and workspace identifiers never appear in it — not in a test, not in a snapshot,
not in a journal entry, not in a bug reproduction.

If a fixture is missing something you need, **extend the fixture set**. Do not reach for real data
to "make the test realistic".

## Deliberately unlike any real instance

The area list here is six invented areas with invented weights. It does not mirror any real
configuration, and that decoupling is the point — a fixture that resembles the live instance invites
someone to "just update it with the real numbers".

## Contents

| File | Purpose |
|---|---|
| `areas.json` | Six areas plus the Run and Signals lanes, with weights for two years |
| `initiatives.json` | Initiatives across every status, with dependencies and deadlines |
| `objectives.json` | Annual and monthly objectives with key results |
| `task-mirror.json` | The task tool's anchor subtrees, mirrored — what `progressComputed` is counted from |
| `area-mappings.json` | External location → area — what makes a completion an **attributed** minute |
| `bindings.json` | Role key → external store identifier, with **invented** identifiers |
| `scoring/wsjf-balanced.golden.json` | Golden inputs → expected outputs for the shipped method |
| `schedule/cpm-cases.json` | Four scheduling networks with **hand-computed** CPM results |
| `connectors/` | Recorded external API responses — **redacted before saving** |

## The task mirror is what makes computed progress reachable

`progressComputed` ([ADR-0013](../docs/20-decisions/0013-self-assessed-progress.md)) is counted
from `task_mirror` and from nothing else: `task_total` and `task_done` are subqueries joined
through `key_result_served_by` on the key result's serving initiatives. Before
`task-mirror.json` existed the fixture set carried no mirror, so **every key result from a plain
seed reported a computed progress of `null`** and the self-versus-computed divergence — the
behaviour the whole model exists to surface — could only be reached by hand-seeding rows inside a
test.

`task-mirror.json` states the counting rule where it is easy to check, and covers six cases: a
finished key result, one ahead of its self-assessment, one behind, the large divergence, one whose
initiative carries an anchor and no subtasks, and one with no serving initiative at all. The last
two are `null` for different reasons, and a fixture that collapsed them would hide the difference.

**It is not free.** `task_mirror` also feeds the four-week capacity window and the initiative
detail's task list, so seeding it widens what every suite sees. That is the point rather than a
side effect — a mirror a test could opt into would leave the divergence unreachable from a plain
seed — and a suite that measures a window it builds itself is expected to start from an empty
mirror rather than to assume there is no fixture data.

**It also covers initiatives that serve no key result**, which is a different gap from the one
above and was found the same way. A subtree exists for `progressComputed` only if some key result is
served by its initiative; without one, the initiative detail showed an empty task list from a plain
seed, and an empty task list is indistinguishable from a screen that is broken. `init-005`,
`init-009` and `init-013` carry subtrees for that reason, and their completed work is dated
**outside** the rolling four-week window deliberately — the mirror feeds the capacity window too, and
moving every suite's balance numbers to fill a detail screen would be the wrong trade. A suite that
wants a completion inside the window seeds one.

## Attribution needs a mapping, not just a completion

`area-mappings.json` is the other half of what a plain seed was missing. `area_mapping` is what turns
a completion into an **attributed** minute — `attribute.ts` resolves a section's location first and
falls back to its project — so with no rows in that table every completion the fixture set could
produce was unattributable, and the balance chart read as empty for a reason indistinguishable from
a defect in prisme.

The mapping's external identifiers are the ones `connectors/task-tool.completions.json` actually
reports, which is what makes it reachable rather than decorative, and one entry refines a section
that its project also covers so the precedence is exercised by a plain seed.

**In a real instance this file has no counterpart.** A person's mappings live in `seed/`, are loaded
by `prisme-sync bindings --from`, and never enter this repository ([`17-privacy.md`](../docs/17-privacy.md)).

## The two-year span is intentional

`areas.json` carries weights for both 2026 and 2027 so that the year-boundary behaviour is testable:
a chart of 2026 must use 2026 weights even after 2027 weights exist. That is the easiest thing to get
wrong in the KPI surface, and the fixture exists so it is caught by a test rather than by disbelief.

## Golden files and versioning

`scoring/*.golden.json` pins scoring inputs to expected outputs. **A diff in a golden file requires
a `version` bump on the scoring method** ([ADR-0006](../docs/20-decisions/0006-pluggable-scoring.md)).
CI enforces the pairing — that check is what keeps method versioning honest rather than aspirational.

## The bindings fixture is not the example file

`seed.example/bindings.json` documents the format an instance copies, and every one of its
identifiers is `REPLACE-ME`. The loader **refuses** a placeholder rather than binding to it — a store
addressed by the literal string `REPLACE-ME` fails at the first query, which is nowhere near the file
that caused it — so the example cannot double as a test fixture. `bindings.json` here is the same
shape with invented identifiers, and it is what the loader's tests read.

## Recording connector fixtures

When capturing a real API response to reproduce a bug:

1. Capture it locally.
2. **Redact before saving**: replace every title, name, ID and URL with synthetic values. Keep the
   *shape* — that is the only part a contract test needs.
3. Confirm the redacted file passes the privacy deny-list scan.
4. Only then commit it.

The unredacted version stays outside git. This step is skipped under pressure more than any other,
which is why it is written down here rather than assumed.

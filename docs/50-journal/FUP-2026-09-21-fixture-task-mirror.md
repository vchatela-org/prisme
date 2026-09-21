# FUP · 2026-09-21 · A task mirror in the fixture set

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes W11's follow-up: *"`fixtures/` has no task mirror, so `progressComputed` is null on every key
result from a plain seed. The divergence in ADR-0013 — the behaviour this workstream exists to
surface — cannot be exercised without hand-seeding `task_mirror` rows."* W11 offered two ways out —
carry a mirror in the fixture set, or derive one from `progressComputedHint`, *"which today is read
by nothing"* — and this takes the first, then removes the hint.

## What was done

- **`fixtures/task-mirror.json`** — twenty-seven synthetic rows: one anchor per covered initiative
  plus the subtasks beneath it. It states the counting rule where a reader can check it, and it
  covers six cases rather than one.
- **`seedFixtures`** loads it, after initiatives (it references `initiative` and `area`) and before
  objectives, so a plain seed now produces computed progress.
- **A test that exercises the divergence**, which is the gap's whole point: six assertions over the
  fixture, including the two `null`s that must not be collapsed.
- **`progressComputedHint` removed** from `fixtures/objectives.json`. Its story moved into the
  mirror, and a field nothing reads that duplicates a fixture file is the drift W11 found once
  already.
- **Two tests adjusted**, deliberately and visibly, because the fixture now widens what every suite
  sees — see *Surprises*.

## Decisions taken

**The mirror is a fixture file, not a derivation from `progressComputedHint`.** W11 offered both.
A derivation keeps one source of truth but makes the data invisible: the count behind "computed is
70" would live in a seeder, and a reader of `fixtures/` could not see what the Objectives screen
will show. A file makes the dataset inspectable, which is what every other fixture here is for.
Having chosen the file, the hint becomes a second source of truth for the same number, so it goes.

**The anchor rows are in the fixture, not left out.** The counting rule is
`is_anchor = false` — the initiative's own task in the task tool is never counted. A fixture that
omitted anchor rows would never exercise that exclusion, which is the kind of omission that lets a
count drift.

**Two `null`s, kept distinct.** A key result whose initiative carries an anchor and no subtasks is
`null` because there is nothing to count; one with no serving initiative at all is `null` for a
different reason, and the tests assert both. Collapsing them into "no progress" would hide the
difference between an unmirrored initiative and an unserved key result.

## Surprises

**Seeding the mirror widens what every suite sees, and that is the cost rather than a side effect.**
`task_mirror` is not only `progressComputed`'s input: it is also the four-week capacity window's
source and the initiative detail's task list. Two existing tests failed on the first run, and both
were right to.

- The balance suite measures a window it constructs itself and asserts the absolute numbers it
  wrote. The fixture's completions land in the same four weeks. It now **starts from an empty
  mirror**, with the reason written where the next person will read it. The alternative — asserting
  a delta — would have hidden the one thing that test is for: that a numeric share arrives as a
  number and not as a string.
- The objectives suite asserted that a key result with no tasks reports `null`, and served it from a
  fixture initiative. It now creates the serving initiative itself, so the assertion is about *no
  tasks* rather than about *which fixture rows happen to exist*.

This is the same trade W15 declined for `area_mapping` — *"mappings feed the backfill's attribution
too, and quietly changing what every suite sees is how one workstream breaks another's numbers"* —
and the difference is that it is done **loudly here**: the change is the point of the gap, it is in
the fixtures README, and the suites it moves were updated in the same commit rather than left to
fail later. The `area_mapping` decision stands.

**`seedCompletions` and the fixture overlap.** `apps/api`'s `seedCompletions` builds task-mirror
rows from a list for tests that need exact data. It stays: it is how a test writes *its own*
completions, and the fixture is what a plain seed gives you. The balance suite now uses both, and
says so.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| `fixtures/` still carries no `area_mapping` rows | W15's recorded shape, deliberately **not** changed: mappings feed attribution, and W15 declined to widen the shared fixture for exactly that reason. Its own suite seeds one | a later follow-up, if the trade is revisited |
| The task mirror covers only the initiatives that serve key results | Initiatives with no key result behind them have no mirrored subtree, so the initiative detail shows an empty task list on a plain seed | a later follow-up |

## Checks

Read back from the pull request after the final push. Locally before pushing:

| Check | Result |
|---|---|
| `npx vitest run` (both test database URLs set) | 1 927 passed, 110 files — 173 integration assertions against a real PostgreSQL 17 |
| `tsc -b` | clean |
| `eslint apps/api/src` | clean |
| `prettier --check .` | clean |
| `pnpm build` | all packages and three apps |
| `./scripts/privacy-scan.sh` | clean, 43 patterns |

## Privacy

Fixture and invented data only. Every task id in the new fixture is a readable synthetic string
(`t-i001-1`), and no UUID literal appears — the deny-list has refused one twice in this project and
the fixture does not need the shape. Every title, area and date is invented. No real goal, project,
task, weight or workspace identifier appears in this entry or in the diff.

## Specs touched

`fixtures/README.md` gained a section, because the fixture set's contract is what that file is.
`docs/20-decisions/0013-self-assessed-progress.md` was implemented as written and needed no
correction; it is now reachable from a plain seed, which is a better outcome than a correction.

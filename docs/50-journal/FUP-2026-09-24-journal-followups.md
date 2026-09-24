# FUP · 2026-09-24 · Nine obligations the register did not hold

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

A review before starting the functional phase found that the follow-up wave's own table was
incomplete: **nine obligations existed, and this file held none of them**. Eight lived inside a
journal entry — most of them as a row in that entry's own *Follow-ups* table — and one had no record
anywhere at all. All nine are rows in [`STATUS.md`](../../STATUS.md) now.

It changes no behaviour. It is the change that makes the next one findable.

## What was done

- **Nine rows added to the Follow-up wave table**, each naming the entry that recorded it, what it
  costs, and who owns it — including the one row that says **the deployment's bootstrap runbook has
  no step for areas, weights or mappings**, which is in the deployment repository and had been
  written down nowhere.
- **The prose under the table now says the sweep was not finished the first time**, and counts it:
  four rows were promoted on 2026-09-24, and this session found nine more. The number is written
  down because this file has already carried a count that was wrong for five days while nothing
  read the file to notice.
- **`STATUS.md`'s header now points at the rows rather than at a wave.** What stands between the
  repository and the functional phase is no longer a workstream.
- **One stale cell corrected**: the `/dependabot` scheduling row still said `this branch`, which is
  what a cell says when it is written before the pull request number exists and nobody returns to
  it. It names [#71](https://github.com/vchatela-org/prisme/pull/71).

## The nine, and the one distinction that matters

Seven are **obligations**: nothing loads areas, weights or mappings from the seed path; nothing
generates `AREA_COLOR_PINS`; nothing schedules the backfill; `review/year` and the area detail call
`minutesCaveat` without its source; the deployment's drift alert was withdrawn rather than repaired;
"not read" cannot be told apart from a refused read; and `fixtures/` carries no `area_mapping` rows
with a task mirror that covers only key-result-serving initiatives.

One is a **deliberate absence**, and it is marked as one: cycle time is drawn nowhere, because
prisme records no moment at which an initiative started and reconstructing one from the event log is
aggregation the API owns. Marking it ⏸ rather than 🟡 is the point — a reader who finds it in a list
of gaps will otherwise treat it as work, and it is a decision.

One was **recorded nowhere**: the deployment's bootstrap runbook configures credentials, the OIDC
client, the role bindings and a restore rehearsal, and has no step for areas, their weights or their
mappings. That was found by reading the runbook while planning this batch, and it is why the seed
path is the first thing this batch implements rather than a nicety: without it, a live instance's
areas and mappings can only be set by hand-written calls.

## Decisions taken

**Read the entries, do not re-derive the gaps.** Every one of the nine was already written down, in
prose a later reader had no reason to open. The table's own rule — *a row here is an obligation, not
a note* — is what makes this a defect rather than untidiness, and the fix is to move the row, not to
re-explain the gap in a second place.

**The register is the deliverable, and the work it names is separate.** The nine rows are `🟡`. This
change records them; the batch that follows closes them one pull request at a time, and each row is
updated by the change that closes it rather than in advance of it.

**Two of the nine are in the deployment repository and are marked as such.** The withdrawn drift
alert and the runbook gap are not fixable from here — this repository contains no cluster
configuration ([`docs/15-runtime.md`](../15-runtime.md) §1) — and a row that does not say so would
have somebody plan work in the wrong tree.

## Surprises

**The seed path is a spec claim that was never implemented.** [`docs/17-privacy.md`](../17-privacy.md)
says areas, weights, tool mappings and external IDs load from `seed/`, and
[`docs/13-migration.md`](../13-migration.md) step 1 depends on it. In the code,
`parseBindingsFile` looks at the `documentTool` key and nothing else, so the `areaMappings` array
sitting in the same file is parsed by nobody; `seed/areas.json` has no loader at all; and
`pnpm seed:load`, which [`seed.example/README.md`](../../seed.example/README.md) tells the reader to
run, is in no `package.json` in the repository. A documented command that does not exist is worse
than an absent one: it looks like the configuration step is handled.

**Silence is what made this hard to see.** The bindings loader is strict everywhere it reads — an
unknown role, an empty identifier and a `REPLACE-ME` left in place are each refused with the file
and the role named — and it is silent only about the key it never looks at. The failure being
*absence of reading* rather than a bad read is why no test caught it: there is no wrong value to
assert on.

**A narrow `backfill` is not a bounded one, and the plan for the refresh has to account for it.**
`planResume` returns the **union** of the requested range and the cursor's coverage, and the
materialise phase works over that union — so calling the backfill with a four-week window on an
instance whose cursor covers three years would re-materialise three years, every pass. That is
recorded here because it is the kind of thing that looks right in review: the request is narrow, and
the work is not.

## Verified by running

Documentation-only, so what there is to verify is that the file still holds together and that
nothing real was written into it.

| What was checked | Result |
|---|---|
| `docs` workflow's internal-link and anchor check | every added link resolves; the table's pipes are escaped where they appear inside a cell |
| The two counts this file now writes down (four promoted, nine found) | recounted against the table by hand, twice, because this file has already carried a wrong count |
| Privacy deny-list scan over the working tree | clean |

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The nine rows | This change records them; each is closed by the pull request that implements it, in the order the register lists them | the batch that follows |
| A check that the register and the journal agree | Nothing reads either file, which is how a count went wrong for five days and how nine rows went missing — a lint that every entry's *Follow-ups* table has a corresponding row would have caught all nine | a later follow-up, and it is not obvious how to make it more than a heuristic |

## Not done

- **None of the nine is fixed here.** This is deliberately the smallest possible change that makes
  the rest findable, and it is first so that the pull requests which follow have rows to close.
- **The deployment repository is untouched.** Its runbook gap and the withdrawn drift alert are
  recorded, not repaired; changing that tree is a separate decision.
- **The register-versus-journal check.** Suggested above and not built, because a heuristic that
  fails on a legitimate entry teaches people to ignore it — and the previous session's lesson about
  new check *names* applies here too.

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `privacy deny-list` | local + CI | local clean |
| `internal links` | CI | every added link resolves |
| the rest of the required set | CI | see the rollup on the pull request — documentation-only, and the rollup is still read back rather than assumed |

## Privacy

No real data of any kind. This entry names no area, weight, identifier, hostname or workspace, and
the deployment repository is referred to as *the deployment repository* rather than by path — the
sibling directory it lives in is a private tree and its name is not this repository's to carry. The
nine rows quote the shape of a gap, never a value from one. Deny-list and secret scans are green.

## Specs touched

- [`STATUS.md`](../../STATUS.md) — nine rows added, the sweep's count written down, the header
  re-pointed at the rows, and one stale cell (`this branch`) named.
- [`docs/50-journal/INDEX.md`](INDEX.md) — this entry's row.
- No spec in `docs/` is contradicted. Two are **quoted as unimplemented** rather than changed:
  [`docs/17-privacy.md`](../17-privacy.md) §3 and [`seed.example/README.md`](../../seed.example/README.md)
  both describe a seed path that does not exist yet, and the row that records it names them rather
  than editing them into agreement with the code — the code is what will move.

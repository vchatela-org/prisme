# Journal

Append-only run notes. Every agent or person finishing a piece of work adds an entry and a row here.

This is the project's **memory**: it survives sessions, and it is what a later agent reads to avoid
re-deriving something that has already been worked out — or re-making a mistake that has already
been made once.

## ⚠ The journal is public

Entries record **what was decided and why, never what the data said.**

- ✅ "Adopted 7 unlinked objectives; 2 needed manual matching because titles had diverged."
- ❌ Anything naming a real objective, project, area, task or workspace.

Debugging notes that genuinely need real values go in a `<entry>-private.md` sibling, which is
gitignored. This is the likeliest leak path in the project, because it happens under pressure —
see [`../17-privacy.md`](../17-privacy.md).

## Entries

| Date | Workstream | Entry | Summary |
|---|---|---|---|
| 2026-09-15 | P0 | [P0-2026-09-15-foundation-docs.md](P0-2026-09-15-foundation-docs.md) | Model, ADRs, workstream briefs and privacy machinery written |
| 2026-09-15 | P0 | [P0-2026-09-15-oq9-identity.md](P0-2026-09-15-oq9-identity.md) | OQ-9 closed: forward-auth with a **verified** assertion (ADR-0021). W14 unblocked |
| 2026-09-15 | P0 | [P0-2026-09-15-backups-are-infrastructure.md](P0-2026-09-15-backups-are-infrastructure.md) | Backups owned by the deployment repository as a dump CronJob (ADR-0022); this repo ships none. Gates step 8 only |
| 2026-09-15 | P0 | [P0-2026-09-15-publication-sweep.md](P0-2026-09-15-publication-sweep.md) | Sweep run, history redacted, **repository made public**. MIT chosen (OQ-8). CodeQL still owes `javascript-typescript` |

## Format

```markdown
# <Workstream> · <date> · <short title>

**Agent/author** · **Duration** · **Outcome:** complete | partial | blocked

## What was done
## Decisions taken            and why. New ADRs raised, if any
## Surprises                  what differed from the brief or the specs
## Follow-ups                 what the next person should know, with owners
## Specs touched              docs updated because reality diverged
```

## Rules

1. **One entry per run**, even a short or failed one. A blocked run is worth more to the next person
   than silence.
2. **Update this index** in the same commit.
3. **Correct the specs** when reality diverges from them, and say so under *Specs touched*. A spec
   nobody trusts is worse than no spec, because it is cited with confidence.
4. **Record what you did not do** and why. An unexplained gap gets rediscovered the expensive way.

# FUP · 2026-10-28 · S1, first step: a task kept as a key result is read as one

**Agent:** Claude · **Duration:** one run · **PR:** [#180](https://github.com/vchatela-org/prisme/pull/180) · **Outcome:** the adoption scan
compares an unlabelled task with key results and objectives across kinds; the first *Explore* item
of S1 in `docs/19-how-it-works.md` is done, the other two stay open

S1 says an objective or key result kept as a task takes the *initiative* door: the classifier reads
structure and labels, never titles, and rules 2–4 compared a candidate only with entities of its own
kind. So such a task was a loose task left out of the queue, or an initiative, and
`13-migration.md` §4's *key result, with that task as its anchor* had no path that found it.

## What was done

- `resolveAcrossKinds` (`apps/sync/src/adoption/resolve.ts`): once own-kind resolution has found
  nothing, a top-level task with no label of prisme's has its title compared again — exact, then
  normalised, same area, same open-or-closed, exactly one or nothing:
  - against the **unbound key results** — a match becomes a `key_result` candidate proposed against
    that key result, at the rule's own confidence (high or medium), for *Link*;
  - then against **every objective**, bound or not — a match becomes a `key_result` candidate with
    no proposal, and the row's existing *needs_objective* refusal says to write the key result under
    its objective and *Rescan*.
- `AdoptionStore.loadObjectives()` reads every objective; `loadTargets` no longer offers a key
  result a link already names.
- Specs and guide: `13-migration.md` §3 and §4, `18-user-guide.md` §2.6, `19-how-it-works.md` §4
  and S1; the queue route's description says which loose tasks are now queued.

## Decisions taken

- **Only rules 2 and 3 cross kinds, never fuzzy.** A fuzzy match across kinds is a guess about what
  a thing is on top of a guess about which one it is.
- **An objective match proposes nothing.** The objective's one external object is its page, and
  linking a task to it would record a link nothing honours. The row is a key-result question
  instead, answered with the flow that already existed (*create, Rescan, Link*), now discoverable.
- **Objectives are matched bound or not; key results unbound only.** The objective a task repeats is
  usually the one adopted from its page, so filtering bound ones out would miss the very case S1
  describes. A key result is a proposal target, so guard-1 reasoning applies — and since nothing
  binds a key result to its task yet (S15), the ledger is what says it has one.
- **A labelled task is left to its label.** `prisme`, `prisme:kr` and `prisme:ritual` are the
  intent channel and outrank a title. The `prisme` label is answered by the reconciler's next pass,
  which the queue never sees, so changing it is the second *Explore* item, not this one.
- **No new match rule, so no migration.** The cross-kind result carries `exact_title` or
  `normalised_title`; what crossed is said by the candidate's kind and reason.
- **A task with subtasks titled as an objective is no longer offered as an initiative.** That is
  the point of S1, but it removes *Adopt* from that row; *Link* and *Ignore* stay.

## Not done

- Flagging an initiative whose deadline is more than six weeks out, or whose title equals an
  objective's (S1, second item) — the labelled path.
- *Convert to key result* on an initiative (S1, third item).
- The task linked to a key result is still not managed as an anchor (S15).

## Checks run locally

Node 24.21.0 (the repo pins 26; CI runs that): `apps/sync` adoption unit suite, the adoption
integration suites against `prisme_test`, `tsc --noEmit` for `apps/sync`, eslint on the changed
files, and the privacy scan with the local supplement.

## Specs touched

- `docs/13-migration.md` §3 (the cross-kind exception) and §4 (*what becomes what*).
- `docs/18-user-guide.md` §2.6, `docs/19-how-it-works.md` §4 and §9 S1.

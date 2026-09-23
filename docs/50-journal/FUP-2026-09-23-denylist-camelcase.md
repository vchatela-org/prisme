# FUP · 2026-09-23 · The deny-list covers the camelCase id, and the control that proves it does

**Agent:** Claude · **Duration:** one session · **PR** [#58](https://github.com/vchatela-org/prisme/pull/58) · **Outcome:** complete

Closes the follow-up [FUP-2026-09-22-todoist-api-v1.md](FUP-2026-09-22-todoist-api-v1.md) recorded:
*"camelCase id positions (`projectId: "…"`) are still uncovered — the deny-list is line-based and
case-insensitive but has no camelCase variants; adding them produced a false positive on
`projectId = parentExternalId` … a later follow-up, needing a pattern that can tell a value from an
expression."* That is what this is.

## What was done

- **`.github/privacy-denylist.txt`** gains one pattern, for the task tool's `v1` id shape under a
  camelCase key, and a comment stating what it does and does not cover.
- **`scripts/security-gates-selftest.sh`** gains a second privacy plant — a generated camelCase id in
  a value position — and the UUID plant is now **withdrawn before it**, which is the bug this change
  found in its own control (below).
- **`docs/17-privacy.md` §2.4** records that an identifier is only a hit in a position where one is
  written, that the key's spelling is part of that, and what the quoted-value rule deliberately
  leaves uncovered.

## Decisions taken

**The value must be quoted, and that is the whole of the design.** `grep -E` has no lookahead, so
"an id, but not an identifier" cannot be expressed directly — and the pair that must be separated is
genuinely adjacent: `projectId: parentExternalId` is sixteen alphanumeric characters in a key-shaped
position, and it is a **destructuring rename**, i.e. code. Any separator-only rule matches it (the
existing snake_case pattern does, which is why it was rejected when first attempted). A quoted
string literal is the one tell available, so the pattern requires one: `["']` before the value.

**The snake_case pattern is left exactly as it is.** It is not merely working — it is the pattern the
`v1` migration was *about*, and the entry above records it having already been weakened once by a
well-meaning edit. A narrowing to match the new one would trade a real coverage loss (unquoted
`project_id: …`, which is the YAML and `.env` shape) for symmetry nobody needs.

**What it does not cover is written beside it rather than left to be discovered.** An unquoted
camelCase value (`projectId: 6X7fH2kQ9pLmN3rT` in YAML or JSON5), and a quoted all-letters
sixteen-character word. The first is covered by the snake_case pattern wherever the key is
snake_case, which is what those formats normally use. Stating a control's limits on the control is
the difference between a gate and a feeling of safety.

## Surprises

**The first version of the new control passed for the wrong reason, and watching it fail is the only
thing that caught it.** The check scans **every staged file**, so the second plant — added beside the
still-staged UUID plant — was refused by the *UUID* pattern, and the camelCase check went green with
its own pattern doing nothing. It was verified by removing the pattern and re-running: the check
still passed, which is how a control that is really a re-run of the one above announces itself.

This is the exact failure the script exists to prevent, one level up: **a negative control that is
not watched fail is a gate nobody knows is wired up** — and the first draft of this change was one.
It is now withdrawn-file-by-file, and the comment in the script says why so the next person adding a
third plant does not repeat it.

**A cleanup that fails takes the summary with it.** Withdrawing the UUID plant made the final
`git rm` fail on a file that was no longer there; under `set -e` that aborted the script *after* the
checks and *before* the line that says how they went. The run printed three of four results and no
verdict, which reads as a partial success and is not one. `--ignore-unmatch` now, with the reason
recorded.

**No false positives, and that was checked against the whole history rather than the tree.** The new
pattern was run over `--history` — every blob ever committed — because the deny-list's risk is
asymmetric: a too-narrow pattern is a silent hole, and a too-broad one blocks every future push with
a match on ordinary code. 45 patterns, clean, both modes.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| A camelCase pattern for `labelId` | The snake_case list omits `label_id` too, so this is parity rather than a new gap — but the task tool does carry label ids | if it recurs |
| `privacy-scan.sh --worktree` scans tracked files only | A new file reads clean until staged, which is W06's follow-up #3 and the same class as this one | this wave, next |

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `privacy deny-list` (worktree) | local | clean, 45 patterns |
| `privacy deny-list` (`--history`) | local | clean — every blob ever committed |
| `security gate self-test` | local | **green, and watched fail twice** — the new plant is refused, and removing its pattern turns exactly that one control red |
| `internal links` | local | clean |
| `typecheck` / `lint` / `test` / `build` / `rest` | CI | see the rollup on the pull request |

**Watched fail, in this order:** pattern added → all four controls green; pattern removed → *"✗
privacy deny-list (camelCase id): the gate did NOT fire"*, one failure, exit 1, the other three still
green; pattern restored → green again. The intermediate state is why the first draft was wrong, and
it is recorded above rather than quietly corrected.

## Privacy

This change *is* the privacy control, so the entry is written for the rule it serves: **no real
identifier appears in it.** The planted values are generated at run time, the pattern describes a
*shape*, and the illustrative ids in the comments (`6X7fH2kQ9pLmN3rT`) are invented and contain no
workspace information. The new pattern was checked against the full history before being trusted, so
it is known not to fire on anything already committed.

## Specs touched

[`docs/17-privacy.md`](../17-privacy.md) §2.4 — the identifier-position rule, the quoted-value design,
and its deliberate limits. The behaviour diverged from what the spec implied (that the shapes were
listed, full stop) rather than the spec being wrong; the sentence is added so the next reader does
not have to read the pattern to learn where it looks.

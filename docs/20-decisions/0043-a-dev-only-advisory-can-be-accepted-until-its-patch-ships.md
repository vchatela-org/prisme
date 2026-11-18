# ADR-0043 · A dev-only advisory with no patch can be accepted, by name and until a date

**Status:** Accepted · 2026-11-18 · decided by the owner, who chose this course when asked
whether to hold the dependency wave or to record a time-boxed exception. It does **not**
supersede [ADR-0027](0027-audit-gate-fails-closed.md): the gate still fails closed, still asks the
advisory database on every run, and still refuses `--ignore-registry-errors`.

## Context

On 2026-11-17 the advisory feed published **GHSA-fc5q-39xc-vjpf / CVE-2026-112366** against
`picomatch`, **high**, a ReDoS through single-branch repeated extglobs. `pnpm audit` at
`moderate` found it against this lockfile, so the required `dependency audit` check went red on
`main` ([run 44205274074], tip `55be09e`), and every open Dependabot pull request — including the
two Docker-digest-only ones — went red with it. That is the shape the
[2026-10-06](../50-journal/P0-2026-10-06-dependabot-wave.md) and
[2026-10-21](../50-journal/P0-2026-10-21-dependabot-wave.md) runs met.

Three facts separate this advisory from the ones those runs cleared with a lockfile refresh:

1. **No patched version exists.** npm's latest `picomatch` is 4.0.7, the advisory's
   `first_patched_version` is null, and the upstream fix ([micromatch/picomatch#194]) is open and
   unmerged. There is nothing to bump to, and no parent range to widen.
2. **It is dev-only.** Every path in the report is under `vite`, `vitest`,
   `@vitest/coverage-v8` or `typescript-eslint`; none is in the api or web image. The ReDoS needs
   a crafted glob handed to a tool, and this repository's globs are static configuration.
3. **The alternative was to hold the wave indefinitely.** ADR-0027 §7 says the remedy for a red
   audit is a fix, not a flag; here the fix is upstream and has no date.

ADR-0027 makes the required check fail closed, and its *Revisit when* says a change to what the
gate passes on needs an ADR of its own. This is that record.

[run 44205274074]: https://github.com/vchatela-org/prisme/actions/runs/44205274074
[micromatch/picomatch#194]: https://github.com/micromatch/picomatch/pull/194

## Decision

**1. The gate gains a fourth state, `accepted`** (and a fifth, `stale-acceptance`, point 7). It
means: the advisory database answered, and every finding at or above the level matches a live
acceptance. `accepted` exits 0 so the required check can go green, but it is **not**
`checked-clean`: the job summary names each accepted finding with its advisory id, expiry and
reason, and the workflow prints a `::warning::` annotation. A reviewer can never read it as
"nothing was found".

**2. An acceptance is a committed file, `.github/dependency-audit-allowlist.json`.** Each entry
carries exactly five non-empty fields — `id` (GitHub's advisory id), `module`, `expires`
(`YYYY-MM-DD`), `reason`, `tracking` — and the file is capped at ten entries. It is reviewed and
merged like code, so accepting an advisory is a visible act with a name on it, not a setting.

**3. Acceptance is narrow.** It applies only when:

- the id and the module both match the finding;
- `expires` has not passed (the listed day is the last accepted day);
- the finding is **not `critical`**;
- **every** path in the finding is `dev: true` — one production path is enough to refuse it.

**4. The gate fails closed on its own allowlist.** No file means no acceptances. An unreadable
file, invalid JSON, a missing field, an `expires` that is not a date, or more than ten entries is
`unchecked` — red, with the allowlist named as the cause. An expired entry refuses its finding,
so the check goes red with "acceptance expired on …" rather than silently widening.

**5. A finding the report does not name is never accepted.** If the severity counts and the named
advisories disagree, the gate stays `vulnerable`: something was counted and cannot be matched to
an entry, so it cannot be accepted.

**6. Nothing else about ADR-0027 changes.** `--ignore-registry-errors` stays out of the command,
the audit level stays `moderate`, the check stays required, the retry stays bounded, and the
controls stay inside the same required job. The controls grow the cases above, including a
committed allowlist that must be readable on every run.

**7. The lift-off is enforced, not remembered.** Amended 2026-11-18, the day this ADR was accepted,
after the owner asked how the exception is guaranteed to come off. The gate gains a fifth state,
`stale-acceptance`: when the audit reports nothing at or above the level but the allowlist still
holds an entry, the check is **red** and names the entry to delete. The consequence is the point:
the pull request that makes the advisory disappear must also delete its entry, so the fix and the
lift-off land together. An acceptance can never outlive its finding as a dead waiver, and deleting
it is required work (the annotation says so), not a check being weakened. The expiry date remains
the second, independent backstop: if no fix ever arrives, the entry refuses its finding on the day
after `expires` and the check goes red even though the advisory is still there.

## Consequences

- **The wave can land, and the release can ship** while the advisory is visible and time-boxed.
  The green it produces is honest about what it is: read, accepted, and expiring.
- **A date is now a failure mode.** On 2026-12-19, if `picomatch` still has no patched release and
  the entry is not renewed on purpose, `main` and every pull request go red again. That is the
  intended behaviour, and the selftest prints a warning as soon as the committed entry is past.
- **The lift-off is a state, not a promise.** The moment the audit stops reporting the advisory,
  `stale-acceptance` keeps the check red until the entry is deleted in the pull request that
  patched the dependency. A dependency fix merged with its acceptance left behind cannot go
  green, and the annotation names the file and the entry.
- **The exception is visible in two places that cannot rot silently**: the committed file (a diff
  anyone can read) and the job summary of every green run (a line naming the acceptance).
- **The mechanism could be abused by a future change.** The refusal of critical findings, of any
  production path, and of unnamed counts are what bound it; a control watches each one fail, so
  loosening them is a red control rather than a quiet green.

## Alternatives

- **Hold the wave until upstream ships 4.0.8.** Honest and requires no code, and it is what the
  2026-10-21 run did. Rejected by the owner because the blocker has no date and the two Node
  digest pull requests cannot cause or fix it.
- **Pin `picomatch` to the open fix PR's commit** (`pnpm.overrides` to a GitHub ref). Clears the
  version match without touching the gate, but imports an unreviewed third-party fork commit into
  the supply chain to silence an advisory about supply-chain trust. Rejected.
- **Lower the level, drop the check, add `--ignore-registry-errors`, or filter by path.** All are
  the gate passing without a reading that ADR-0027 forbids. Rejected.
- **Accept silently by ignoring a specific advisory id inside the script.** No reviewed file, no
  expiry, no reason, invisible in the diff of a normal dependency pull request. This ADR's whole
  point is that the acceptance itself must be the reviewed artifact.

## Revisit when

- **2026-12-19**, the day after the first entry's expiry: patch `picomatch` (or renew the
  acceptance with a new reason and a new date).
- A production finding ever needs accepting. That is not this decision; it needs its own ADR,
  because the scope here is dev-only by construction.
- The allowlist reaches its entry cap, or an entry is proposed for a `critical` finding. Both mean
  this mechanism is being used for something it was not decided for.

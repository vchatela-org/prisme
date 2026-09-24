# FUP · 2026-09-24 · The harness gets committed, and running it found two defects

**Agent:** Claude · **Duration:** one session · **PR:** this branch · **Outcome:** complete

Closes the register row that had been a `🟡 recorded, not fixed` for three days and a verbal
complaint for ten sessions: **the harness existed only in a gitignored directory, and every session
rebuilt it from scratch.** It is now `harness/`, tracked, with a README and a driver that fails the
build-shaped way rather than the person-shaped way.

What justified the work is what running it found. Two defects, and neither was visible from reading
anything: the old seeder **wiped the migration ledger**, and the first draft of the provider had no
token endpoint. A harness is only worth committing if it is run to the end, and this one was.

## What was done

| Added | What it is |
|---|---|
| `harness/idp.mjs` | a real, strict OpenID Connect provider: `/authorize`, `/token`, `/jwks`, `/end-session`, and two deliberately bad tokens |
| `harness/env.sh` | the environment all three processes share — the part that kept being re-derived |
| `harness/up.sh` · `down.sh` | one command to a seeded, logged-in stack, and one to stop it |
| `harness/seed.mjs` | truncate-and-seed, safe to run repeatedly |
| `harness/drive.mjs` | the scripted login drive, 40-odd assertions, exits non-zero on failure |
| `harness/README.md` | what it is, what it is not, and the three traps |

Also: `jose` and `postgres` as root devDependencies (the harness needs both and belongs to no
package), `harness/logs/` in `.gitignore`, an ESLint block for CLIs that are in no tsconfig program,
and a line in the root `CLAUDE.md`.

## Decisions taken

**A strict provider, not a stub that returns a token.** Every assertion in `drive.mjs` is about an
*agreement* between two processes, and each half passes its own unit tests while the agreement is
wrong. The one that matters most — `code_challenge` must hash the `code_verifier` the application
**stored** — cannot be checked by either half alone. So the provider recomputes it, refuses a spent
code, refuses a mismatched `redirect_uri`, and echoes `state` exactly as received.

**Committed rather than gitignored, which is the opposite of the rule for `seed/`.** `seed/` holds
real instance data and must never be tracked. The harness holds none: the issuer, client id and
subject are invented, the fixtures are the synthetic set, and the only hostnames are loopback and a
reserved `example.com`. What was being lost by keeping it out of git was never the idea — it was the
details, and the details are the whole cost. Ten sessions is evidence.

**The write freeze stays on, and `SYNC_ENABLED=false` with it.** A scratch environment is exactly
where somebody discovers that a flag they set locally also applies somewhere real.

**Nothing in CI.** CI has no browser, no port allocation and no reason to run three processes to
check a login; the login is already covered at the seam by the API's own suite. This is a tool for a
person, and pretending otherwise would add a required check that cannot fail meaningfully.

## Surprises

**The seeder had been destroying the migration ledger, and had been for as long as it existed.**
It excluded a table called `migration` from its truncate. The ledger is called **`prisme_migration`**
and a table called `migration` has never existed — so the exclusion matched nothing and every table
*was* wiped. The visible symptom is beautifully misleading: the API starts, logs that it is
listening, reports `database: reachable`, and answers **503 on `/readyz` for ever** with
`schemaVersion: null` and the reason *"no migration has been applied; the pre-rollout migration Job
has not run"* — an infrastructure message for a file that truncated a table. The schema objects are
all still present, so every query works and every screen renders. **Found by starting the stack and
reading `/readyz`**, which the harness's own `up.sh` now checks as a matter of course.

**Repairing it was not a matter of re-running the migrations.** They are not idempotent — `0001`
re-creates a function and fails on the second application — and the half-applied run left the ledger
holding one row for `0001` while the schema held all of `0001`–`0009`. The honest repair was to
**recompute the lost rows from the shipped files with the runner's own checksum**, which keeps the
drift detection truthful rather than papering over it, and then hand the ledger table back to the
migration role — because the aborted run had recreated it owned by the superuser, so the role that
owns every other table could not read it. Both are recorded here because the next person to wipe a
ledger locally will hit exactly this.

**The provider's first draft had no `/token` route, and nothing said so.** A 404 there is not a
refusal the application recognises: it logs `exchange_unrecognised_error` and answers 401, so every
downstream assertion failed — twelve of them — with **no line in the provider's log, because the
provider had nothing to log**. The lesson is about the shape of the failure rather than the missing
line: the drive named twenty downstream symptoms and not one cause, and only reading the web tier's
log found it.

**One health check was wrong about the application rather than the other way round.** `up.sh`
expected `/` to answer 303 and it answered 401 — correctly: a request without a browser's `Accept`
header is an XHR as far as the gate is concerned, and an XHR with no credential is 401 on purpose,
because a redirect is not a useful answer to `fetch`. The check now sends the header and says why.

**Lint found a dead assignment the ported driver had carried for three days.** `const replayedAgain =
await startLogin()` — the *call* is load-bearing (it refreshes the state cookie so the replay is
refused for being a replay rather than for being stale) and the binding was not. Dropping the binding
and saying so is the fix; the call stays.

**`pnpm db:status` needs `MIGRATION_DATABASE_URL` and does not default it**, so it fails with a
configuration message rather than a status when only `DATABASE_URL` is set. Correct, and worth
knowing before reading it as a broken database.

## Verified by running

The stack was started with `harness/up.sh` and driven with `harness/drive.mjs` until every check
passed — the full flow: login route → PKCE challenge recomputed from the stored verifier → provider →
callback → session cookie attributes → a **populated** Focus and Backlog screen → the API verifying
the same token independently → logout ending the provider's session too. And the refusals:

| Refusal | Asserted |
|---|---|
| a valid ID token in the assertion header | authenticates nobody on the web tier, and the API rejects a bad one |
| a garbage, expired, or wrong-subject token | 401 — never a silent re-authentication |
| no credential — browser navigation vs XHR | 303 to the login flow, and 401 respectively |
| a POST with a foreign or absent `Origin` | 403, including `/auth/logout` |
| a tampered `code_verifier`, a mismatched `state`, a replayed code | 401, and **no session is written** from any of them |

The seeder was run **three times in a row** and the ledger checked between runs — which is how the
truncate bug was found, and is the property the OIDC entry recorded as broken in an earlier harness.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| `seed/harness/` is still on disk | It is the private scratch this replaces, gitignored, and now superseded — but it is the user's directory, so it is left rather than deleted | the owner |
| The harness is not in CI | Deliberate; recorded above rather than left as a gap somebody re-argues | nobody |
| A browser drive of the screens | The harness gets a person to a logged-in screen; asserting what it *looks like* is still a person's job, or the Playwright MCP server's | whoever next looks at a screen |

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `lint` (eslint) | local, per tree | clean — including a dedicated config block for `harness/*.mjs`, and it found the dead assignment above |
| `prettier --check` | local | clean for every file this change touches; the only warnings are inside pre-existing agent worktrees, which CI does not have |
| `typecheck` | local | clean — no package source changed |
| `test` | local | **2 132 passed**, 123 files, both projects, with the test database's URLs exported |
| `build` | CI | the root gained two devDependencies and no application dependency |
| `privacy deny-list` · `gitleaks` | local (pre-commit) + CI | local clean; the harness names no real instance |
| every other required check | CI | see the rollup on the pull request |

## Privacy

Fixture and invented data only, and this is the change where that needed the most care — a dev
harness is the likeliest place for a real hostname to be pasted "just to make it work". The issuer is
`http://localhost:9099`, the client id and subject are invented, the fixtures are the repository's
synthetic set, and the only non-loopback hostname is `elsewhere.example.com`, used to prove a
cross-origin POST is refused. No real workspace, page id, token or hostname appears in the harness,
in this entry, or in the diff. Deny-list and secret scans are green.

## Specs touched

- No spec in `docs/` describes how to run the application locally, which is itself the gap this
  closes in the repository rather than in a document: [`harness/README.md`](../../harness/README.md)
  and a line in the root [`CLAUDE.md`](../../CLAUDE.md).
- [`eslint.config.mjs`](../../eslint.config.mjs) — a config block for CLIs in no tsconfig program.
- [`STATUS.md`](../../STATUS.md) — the harness row closes, and `is_archived` / `is_locked` stops
  reading as outstanding work: the tool documents neither field, so there is no fix to make.
- [`docs/50-journal/INDEX.md`](INDEX.md) — this entry.

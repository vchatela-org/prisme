# W00 · 2026-09-15 · Foundations

**Agent:** w00-foundations (Claude Opus 5) · **Duration:** one session · **PR** #5 ·
**Outcome:** complete

## What was done

The skeleton the other fifteen workstreams build on, in four parts.

**The monorepo.** pnpm workspaces over `apps/{web,api,sync}` and
`packages/{config,db,observability,domain,connectors,ui}`. Shared `tsconfig` base, one ESLint
configuration, Prettier, one Vitest run. `domain`, `connectors` and `ui` are **slots**: a
`package.json`, a `tsconfig`, and an empty barrel with a note naming the workstream that fills them.
W01, W03 and W07 started the same day and needed the layout, not its contents.

**The configuration loader** (`packages/config`). One Zod schema covering every variable in
[`15-runtime.md §2`](../15-runtime.md#2-configuration-contract), across all three input paths, with
plain environment beating a `<NAME>_FILE` beating the file named by `PRISME_ENV_FILE`. Every problem
is collected and reported together, naming the variable; a value is never echoed. Exit code 78.

**The database tooling** (`packages/db`). Drizzle client, transaction helper, advisory lock, and a
forward-only migration runner that is a **standalone binary**. It refuses three things rather than
guessing: a migration edited after it was applied, one back-filled behind a later one, and a
database ahead of the binary. Nothing calls it at start-up.

**Observability** (`packages/observability`). A structured JSON logger whose *serializer* redacts by
deny-list, so the spec's own worst case — `log.info({ config })` — cannot leak a token. Run-ID
correlation lives in async context. The metrics registry declares all seven metrics from
[`15-runtime.md §5`](../15-runtime.md#metrics) so that W03 and W04 increment rather than invent.

**Images and CI.** Two Dockerfiles for three images, distroless and non-root; five CI checks, an
image build-and-scan gate, and CodeQL over TypeScript.

## Decisions taken

**The configuration contract is per service, not global.** The threat model has always drawn the
boundaries as browser → web → API → PostgreSQL. Requiring `DATABASE_URL` everywhere would have given
the web process a database credential it has no use for, widening the blast radius of an XSS for no
feature gain. `loadConfig({ service })` takes a profile, and the web tier's contract has no database
credential in it at all. Two variables were added to carry the split: `PRISME_API_URL`, and
`MIGRATION_DATABASE_URL` for the DDL role that §3 already specified but had no variable for.

**`/healthz` is asserted, not merely intended.** The liveness route calls nothing, and a test injects
a readiness checker that throws to prove it was never reached. The image gate then repeats the check
against the real container with the database pointed at a host that does not exist: `/healthz`
answers 200 and `/readyz` answers 503. This is the failure the brief warned about twice, so it is
worth two checks in two places.

**The reconciler harness ships without a reconciler.** `apps/sync` has configuration, logging, the
window decision, the advisory lock, the metrics and the exit codes — and logs a warning that no
reconciler is registered. A stub that returned success would make the CronJob green and the drift
metric zero, which is worse than nothing. W04 attaches the real thing at one marked point.

**An advanced CodeQL setup instead of the repository default.** The publication sweep left
`javascript-typescript` outstanding and assigned it here. The default setup cannot close it: it
derives its language list from the *default branch* and refuses a language that is not there yet, so
the gate could only be enabled after the code it is meant to gate had already merged. Default setup
is now off, and `actions`, `python` and `javascript-typescript` are analysed by a workflow in git
with the `security-extended` suite — reviewable, and running on the branch rather than only on what
has already landed.

**Advisories were fixed, not waived.** Wiring `pnpm audit` as a gate immediately found nine, one of
them a SQL-injection advisory against the pinned Drizzle version — a good demonstration that a gate
which has never run is not a gate. Direct dependencies were bumped; two transitive ones that arrive
through Next.js and drizzle-kit are pinned forward with the reason written beside them. Likewise the
first runtime base image had six fixed HIGH/CRITICAL openssl CVEs, so the runtime moved to the
Debian 13 distroless variant, which has none.

**No ADR was needed and none was raised.** Nothing here contradicts an Accepted decision. ADR-0022
was the one to watch, and it is honoured by absence: no `pg_dump`, no dump client, no backup
entrypoint, no backup metric, and a test asserting the shipped migrations contain no such thing.

## Surprises

**The shared Harbor workflow cannot build this repository.** `docs/15-runtime.md` named it as the
build path. It builds one image from `context: .` and has no input for a Dockerfile path or a build
target, and prisme ships two Dockerfiles that both need the repository root as their context. Rather
than contort the images to fit the tool, publishing is done directly and the spec has been corrected.
Moving back is a one-line change once that workflow grows a `dockerfile_path` input — see
*Follow-ups*.

**A trusted extension still needs a grant.** `CREATE EXTENSION pgcrypto` failed for the migration
role. PostgreSQL has marked `pgcrypto` trusted since 13, but trusted only removes the *superuser*
requirement — `CREATE` on the database is still needed. The role scripts now grant it to the
migration role and not to the application role, which keeps the DML/DDL split intact.

**The two security gates did not behave as expected, which is the entire point of testing them.**
The first fake secret was the canonical AWS example key, which is on gitleaks' own allowlist; it
proved nothing. The second was Slack-shaped, and **GitHub push protection refused the push outright**
— so a provider-shaped token cannot be used to exercise gitleaks in CI at all, because it never
reaches the remote. The third attempt, a fabricated private key, was detected. Both gates were then
seen red on a throwaway branch, which was closed and deleted.

**`privacy-scan.sh --history` is repository-wide.** While that throwaway branch existed it turned
`privacy deny-list` red on *every* open pull request, because the history walk covers every ref the
runner fetches rather than the branch under test. Correct behaviour for a public repository —
history is permanent and shared — but worth knowing before somebody spends an hour on a failure that
has nothing to do with their change.

**Linting needed a build.** `pnpm lint` passed locally and failed in CI: type-aware rules resolve a
workspace package through its `exports` entry, so without `dist` every cross-package type is `any`
and the two rules that are contract rather than style quietly stop applying. The lint job now builds
the packages first. A rule that silently stops applying is the same failure mode as a gate nobody
has seen fail.

## Follow-ups

| What | Owner |
|---|---|
| Add a `dockerfile_path` (and ideally `target`) input to `shared-workflows`, then point `publish.yml` back at it | whoever maintains `vchatela-org/shared-workflows` |
| Set `HARBOR_REGISTRY`, `HARBOR_PROJECT`, `CI_RUNNER` and the Harbor robot account before the first `v*` tag. `publish.yml` skips until they exist, deliberately | the human, with the deployment repository |
| Domain tables, and therefore the first real migration. `packages/db/src/schema/` is empty on purpose | W01 |
| Attach the reconciler at the marked point in `apps/sync/src/main.ts` | W04 |
| Integration tests against a real PostgreSQL. The migration runner and `/readyz` were verified by hand against a container this session; only their pure parts are covered by automated tests | W05, with the API's integration suite |
| Remove the `postcss` and `esbuild` forward pins once Next.js and drizzle-kit ship versions that no longer need them | Dependabot will surface it |

## Specs touched

- [`15-runtime.md`](../15-runtime.md) — the build path corrected away from the shared Harbor
  workflow; the configuration table made per-service and given `PRISME_API_URL` and
  `MIGRATION_DATABASE_URL`; the rendered env-file format written down as built; the role table given
  the `CREATE`-on-database grant; the commands for each entrypoint listed for the deployment
  repository; the open question about the env-file path closed, and the pull-secret one left open
  with a note that it gates nothing here.
- [`14-threat-model.md`](../14-threat-model.md) — the CodeQL row, now naming the three languages and
  the query suite, and why it is an advanced setup.
- [`README.md`](../../README.md) — status line, the workspace layout, and how to build, test, run and
  migrate.

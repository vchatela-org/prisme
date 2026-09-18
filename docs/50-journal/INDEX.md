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
| 2026-09-15 | P0 | [P0-2026-09-15-model-frozen.md](P0-2026-09-15-model-frozen.md) | **P0 frozen.** Dual-owner cell resolved to ADR-0008; cadence map written; 14 anchors and the OQ numbering fixed. Wave 1 cleared |
| 2026-09-15 | P0 | [P0-2026-09-15-branch-and-pr-protocol.md](P0-2026-09-15-branch-and-pr-protocol.md) | Every workstream lands as a **PR on its own branch**, green before it stops, human merges. `enforce admins` closes the bypass that let agents push to `main` |
| 2026-09-15 | P0 | [P0-2026-09-15-ci-verification.md](P0-2026-09-15-ci-verification.md) | "Green" now means **read back from the pull request** after the last push — queued, in progress or absent is not green. Written into all five layers of the branch-and-PR protocol |
| 2026-09-15 | W00 | [W00-2026-09-15-foundations.md](W00-2026-09-15-foundations.md) | Monorepo, per-service config loader, standalone migration runner, redacting logger, distroless images, and the CI gates — both security gates **watched fail** before being trusted. CodeQL now covers `javascript-typescript` |
| 2026-09-15 | W00 | [W00-2026-09-15-close-out.md](W00-2026-09-15-close-out.md) | Post-merge: W00 landed (#5), Harbor configured, a no-reader variable removed, merged branches deleted. First tag `v0.0.1` run — publish failed on a cluster runner with **no Docker socket**, fixed with the `kubernetes` buildx driver |
| 2026-09-15 | P0 | [P0-2026-09-15-node-26-baseline.md](P0-2026-09-15-node-26-baseline.md) | Node 26 becomes the toolchain baseline (ADR-0023); corepack is gone from Node, so the builder installs pnpm from npm at the version `packageManager` pins. Web builder and `engines` follow in PR #10 |
| 2026-09-16 | P0 | [P0-2026-09-16-node-26-web-and-engines.md](P0-2026-09-16-node-26-web-and-engines.md) | Second half of ADR-0023: web builder and its distroless runtime on Node 26 with the same derived pnpm bootstrap, then `engines.node` to `>=26.0.0` — the move `engine-strict` forced to go last. Toolchain now consistent end to end |
| 2026-09-16 | W01 | [W01-2026-09-16-domain-scoring.md](W01-2026-09-16-domain-scoring.md) | Entities, scoring registry, `wsjf-balanced` v1, capacity and now-set selection, plus the domain tables. Properties tested **exhaustively** over the closed input space rather than sampled. The worked example reproduces end to end; purity lint, the new golden/version gate and every database guard were **watched fail** |
| 2026-09-16 | W03 | [W03-2026-09-16-connectors.md](W03-2026-09-16-connectors.md) | Read path to both external tools: role-keyed queries, the two-minute watermark overlap with content hashing, allow-listed sanitisation, the retry policy, and recorded-fixture clients. The issue path is **redacted** before it reaches an error — a document tool keys its properties by names that are instance data |
| 2026-09-16 | W02 | [W02-2026-09-16-schedule-engine.md](W02-2026-09-16-schedule-engine.md) | CPM forward and backward passes, per-area capacity as a concurrency limit floored at one slot, deadline feasibility that flags and never writes, and a replan that recomputes rather than patches. Checked against **hand-computed** networks. Working days are integer UTC day numbers, not a date library — and slack deliberately does not know about capacity |
| 2026-09-16 | W07 | [W07-2026-09-16-design-system.md](W07-2026-09-16-design-system.md) | Tokens, primitives, domain components, chart wrappers, shell and the gallery. The `dataviz` palette adopted and **re-validated** in both modes; an in-fill label helper written, measured at 4.46:1 and deleted. Two bugs no static check could see — a client/server boundary that only fails on request, and a modifier key the component never passed — found by **running** the gallery |
| 2026-09-17 | W04 | [W04-2026-09-17-reconciler.md](W04-2026-09-17-reconciler.md) | The level-triggered reconciler: pure planner, plan/apply, the no-duplicate guards, the conflict matrix, the intent channel and the write path. The adversarial test is **exhaustive** over the closed input space, and convergence is proved by re-planning against an applied world. Two bugs only running found — Drizzle swapping the driver's date handling on the client it wraps, and a column exactly as wide as its widest value |
| 2026-09-17 | W05 | [W05-2026-09-17-api.md](W05-2026-09-17-api.md) | The REST API: 53 routes, each declaring its scope, with the OpenAPI document generated from the same objects the router mounts. The deny-by-default test reads back what Hono **registered** rather than what the registry claims. Two bugs only a real database could show — `delete` refused by an append-only trigger, and `jsonb` arriving as text on which every property access silently yielded `undefined` |
| 2026-09-18 | W14 | [W14-2026-09-18-security.md](W14-2026-09-18-security.md) | Authentication and authorization: the verified assertion, Argon2id scoped tokens, deny-by-default installed, diff-bound confirmations, a kill switch that withholds scopes rather than setting a flag, and a strict CSP with per-request nonces. Eight things only running found — a `READ COMMITTED` race that gave a single-use token two winners, middleware silently not loaded so every security header was absent, and a dependency edge that would have shipped a database driver to the tier that must not hold one. Both secret-scanning gates now have a **negative-control job** rather than a memory of having watched them fail |
| 2026-09-18 | W06 | [W06-2026-09-18-mcp.md](W06-2026-09-18-mcp.md) | Seventeen MCP tools on one stateless endpoint, the protocol written against its specification rather than the SDK (ADR-0024) — seventeen dependencies, including a second HTTP framework and an OAuth client, avoided at the cost of owning conformance. Every write tool is a dry run whose confirmation is bound to a diff **re-derived at execution**. Three things only running found: a `create` diff that could never go stale, a state probe inflating the one count ADR-0010 is about, and a generated manifest carrying literal UUIDs the deny-list was right to refuse. Tool descriptions reviewed by a cold agent, twice — the first run could not complete four of twelve requests |
| 2026-09-18 | W14 | [W14-2026-09-18-settings-followup.md](W14-2026-09-18-settings-followup.md) | The two settings W14 left for a human, closed: `main` now requires `golden fixtures` and `security gate self-test`; secret scanning's validity checks and non-provider patterns are on via a repo-scoped org configuration, after the org default's attach failed silently on a CodeQL setup collision |

## Format

```markdown
# <Workstream> · <date> · <short title>

**Agent/author** · **Duration** · **PR** #n · **Outcome:** complete | partial | blocked

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

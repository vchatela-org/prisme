# prisme

**A personal prioritization platform.** It decides *what comes first* across everything you've
committed to, then keeps your planning tools honest about that decision.

A prism decomposes one beam of white light into an ordered spectrum — one fuzzy set of goals into
a ranked, schedulable sequence of work.

> **Status: P0 frozen, implementation starting.** The model and the workstream specs are settled;
> the monorepo, its CI and its images exist, and the feature workstreams are landing on top. See
> [`STATUS.md`](STATUS.md) for exactly where things stand.

## The problem it solves

Personal task systems fail at **allocation**, not execution. People who use them are usually good
at closing tasks; what they can't do is answer *"is what I did this month what I said mattered?"*

The failure is structural, and it shows up the same way everywhere:

- **Capacity follows friction.** Small, well-defined, pleasant work flows. Large or emotionally
  heavy work waits — regardless of how important you said it was.
- **Several priority systems, none in charge.** A task tool's priority flags, a document tool's
  select fields, a scoring formula in a spreadsheet, a morning top-three. None feeds the others,
  so each one decays independently.
- **Goals live somewhere that can't reach the work.** Objectives written as documents never become
  tasks; objectives written as tasks are never read as objectives.
- **No history.** Neither a task tool nor a document tool keeps a time series, so "am I drifting?"
  is unanswerable by construction.

prisme adds the missing layer: a place that **decides**, holds the history, and reconciles the
decision back into the tools where thinking and doing actually happen.

## How it works

Three stores, three jobs:

| Store | Job |
|---|---|
| **A document tool** (Notion) | Thinking, narrative, archive — prose a human writes and re-reads |
| **A task tool** (Todoist) | Doing — "what do I work on now" |
| **prisme** | Deciding — anything computed, historized, or compared across the other two |

The core ideas:

- **Allocate before you rank.** Each life area gets a share of your discretionary capacity, set
  once a year. Scoring only ever ranks *within* an area; comparing areas is a values decision, not
  a formula's job.
- **Score initiatives, never tasks.** An initiative is an outcome finishable in about one to six
  weeks. Tasks inherit priority from theirs.
- **Deadlines prioritize, dates plan.** A deadline is a hard constraint and drives urgency. A due
  date is when you intend to work on something, and stays entirely yours.
- **One owner per field.** Never per object. This is what makes bidirectional sync tractable.
- **Scoring is a plugin.** WSJF is the first method shipped, not the last. Methods are versioned,
  can shadow-run against each other, and swapping one never needs a migration.
- **A reconciler, not event handlers.** Level-triggered `plan` / `apply`, like `terraform plan`.
  It compares desired state with actual state on every run, so it recovers from restarts, API
  errors and manual edits instead of drifting forever after one missed event.

## What's here

| Document | Contents |
|---|---|
| [`STATUS.md`](STATUS.md) | Where we are: phases, workstreams, open decisions |
| [`docs/00-vision.md`](docs/00-vision.md) | The problem, and what prisme is and is not |
| [`docs/10-model.md`](docs/10-model.md) | The domain model, entity by entity |
| [`docs/11-ownership.md`](docs/11-ownership.md) | Field-level ownership matrix — the core contract |
| [`docs/12-scoring.md`](docs/12-scoring.md) | The pluggable scoring contract |
| [`docs/13-migration.md`](docs/13-migration.md) | Adopting an existing setup without creating duplicates |
| [`docs/14-threat-model.md`](docs/14-threat-model.md) | Assets, trust boundaries, controls |
| [`docs/15-runtime.md`](docs/15-runtime.md) | Images, config contract, deployment interface |
| [`docs/16-sync.md`](docs/16-sync.md) | Sync cadence, conflict policy, the intent channel |
| [`docs/17-privacy.md`](docs/17-privacy.md) | What may and may not be committed here |
| [`docs/20-decisions/`](docs/20-decisions/) | ADRs, plus `OPEN.md` for what's still undecided |
| [`docs/30-roadmap.md`](docs/30-roadmap.md) | Phases and exit criteria |
| [`docs/40-workstreams/`](docs/40-workstreams/) | One brief per workstream — the unit of work |

## Stack

TypeScript monorepo. Next.js for the web UI, Hono for the REST API and MCP server, PostgreSQL via
Drizzle, and a reconciler that runs both as a scheduled job and in-process behind the API's
force-sync button. Everything ships as containers; see [`docs/15-runtime.md`](docs/15-runtime.md).

```
apps/web     Next.js server                 packages/config         one schema for every setting
apps/api     Hono REST + MCP + reconciler   packages/db             Drizzle, transactions, migrations
apps/sync    the reconciler entrypoint      packages/observability  logging, metrics, run IDs
                                            packages/domain         the business rules, pure
                                            packages/connectors     the outside world
                                            packages/ui             the design system
```

## Running it

Node 24 and pnpm 12 — `corepack enable pnpm` after installing the version in `.nvmrc`.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build

cp .env.example .env      # fake values only; .env is gitignored
pnpm dev:db               # PostgreSQL in docker compose, with both roles
pnpm db:migrate           # a Job before rollout in the cluster, a command here
pnpm db:status            # what the database is at, versus what this build expects

pnpm start:api            # http://localhost:3000  — /healthz /readyz /metrics
pnpm start:web            # http://localhost:3001
```

Migrations never run on application start: two replicas would race on DDL. `pnpm db:migrate` is a
separate binary, and in the cluster it is a Job that runs before the rollout.

`./scripts/install-hooks.sh` installs the pre-commit hooks — the privacy deny-list scan and
`gitleaks`, both over staged content. Run it once after cloning.

Images:

```bash
docker build -f apps/api/Dockerfile -t prisme-api .   # prisme-sync is the same build
docker build -f apps/web/Dockerfile -t prisme-web .
```

## Privacy

This repository is **public and deliberately impersonal**. It documents a product; it never
documents its owner's life. No real goals, projects, tasks, area weights, workspace IDs or
hostnames are committed — all of that is instance data that loads into the database from outside
git. Documentation, tests and screenshots use the synthetic dataset in [`fixtures/`](fixtures/).

The rules and their enforcement are in [`docs/17-privacy.md`](docs/17-privacy.md). If you are
contributing — human or agent — read it before your first commit.

## Related

- `vchatela-org/shared-workflows` — reusable GitHub Actions. Not used for prisme's image build: it
  builds one image from the repository root and has no input for a Dockerfile path, which a
  two-image monorepo needs. See the note in [`docs/15-runtime.md`](docs/15-runtime.md#build-requirements).
- Deployment manifests live in a separate, private GitOps repository. This repo produces images and
  the contract to run them; it holds no cluster configuration — and no database backup, which is a
  dump CronJob owned there
  ([ADR-0022](docs/20-decisions/0022-backups-belong-to-the-deployment-repository.md)).

## Licence

[MIT](LICENSE).

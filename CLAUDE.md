# prisme — context for Claude

You are working on **prisme**, a personal prioritization platform. Read this file fully before
doing anything. It is the shared context every agent starts from.

---

## 0. Two rules that override everything

**Rule 1 — This repository is public and impersonal.**
It documents a *product*, never its owner's life. Before writing any file, ask: "does this
sentence reveal a real goal, project, task, weight, ID, hostname or workspace?" If yes, it does not
go in git. Use [`fixtures/`](fixtures/) instead. Full rules: [`docs/17-privacy.md`](docs/17-privacy.md).

This is the single easiest mistake to make, and the hardest to undo — public git history is
permanent. It bites hardest while debugging: you fetch real data, something is wrong, and you paste
the real task title into a journal entry or a test fixture. Don't.

**Rule 2 — One owner per field, never per object.**
Every field in the system belongs to exactly one of prisme, the document tool, or the task tool.
[`docs/11-ownership.md`](docs/11-ownership.md) is the contract. A previous attempt at this system
failed because ownership was ambiguous. If you find a field whose owner is unclear, stop and raise
it as an ADR — do not pick one and move on.

---

## 1. What prisme is

The **decision layer** between a document tool (thinking) and a task tool (doing).

```
Document tool  ──►  prisme  ──►  Task tool
   (why)          (what first)     (how)
      ◄───────── progress ─────────┘
```

Personal task systems fail at **allocation**, not execution. prisme allocates capacity across life
areas first, ranks only *within* an area, keeps the history neither other tool keeps, and reconciles
its decisions back into both.

Read [`docs/00-vision.md`](docs/00-vision.md) once. It is short and it explains why several
obvious-looking designs are wrong.

## 2. Principles you must not quietly violate

| Principle | Consequence if you forget |
|---|---|
| **Allocate before you rank** | Scores compare only within an area. A score that ranks across areas is a bug. |
| **Score initiatives, never tasks** | Nothing in the task tool gets a score. Tasks inherit from their initiative. |
| **Deadlines prioritize, dates plan** | prisme writes `deadline`. prisme **never** writes `due`. |
| **Scoring is a plugin** | Never read a `wsjf` column. Read the active method through the registry. |
| **Weights are year-scoped** | Never a single current weight. Always `(area, year)`. |
| **Level-triggered reconciliation** | Compare full desired vs actual. Never build an event handler that assumes it saw every event. |
| **`plan` before `apply`** | Every write path has a dry run that returns a diff. |
| **Adopt ≠ create** | Adopting existing work must never create a new page or task. See [`docs/13-migration.md`](docs/13-migration.md). |

## 3. Layout

```
docs/                  the specification — numbered, stable paths, cite them by path
  00-vision      10-model      11-ownership   12-scoring    13-migration
  14-threat-model 15-runtime   16-sync        17-privacy     18-user-guide
  20-decisions/  ADRs + OPEN.md        30-roadmap.md
  40-workstreams/  one brief per workstream — your contract if you are a workstream agent
  50-journal/      append-only run notes + INDEX.md
fixtures/              synthetic dataset — the ONLY data allowed in docs, tests and examples
seed/                  gitignored — real instance data, never committed
harness/               the local dev stack: a fake identity provider, a seeder and a login
                       driver. `./harness/up.sh`, then `pnpm harness:drive`
apps/{web,api,sync}    each has its own CLAUDE.md
packages/{domain,connectors,ui}   each has its own CLAUDE.md
.claude/agents/        agent definitions, one per workstream
.claude/skills/        invocable skills for a repeatable run — `/dependabot` integrates the open
                       Dependabot pull requests, one subagent per PR, until each is green
```

Per-directory `CLAUDE.md` files load automatically when you work in that directory. They hold the
scoped detail; this file holds what everyone needs.

## 4. Stack and conventions

TypeScript monorepo, pnpm workspaces. Next.js (web) · Hono (API + MCP) · PostgreSQL + Drizzle ·
Zod for every boundary · Vitest.

- **Boundaries are parsed, not trusted.** One Zod schema per endpoint, parsed before any other code
  touches the value. This includes responses *from* the document and task tools — third-party data
  is untrusted input, and it carries markup and arbitrary URLs.
- **`packages/domain` is pure.** No I/O, no clock, no randomness — pass them in. It is the only
  place business rules live, and it is the easiest thing in the repo to test properly.
- **SQL is parameterized, always.** Drizzle query builders. No string-built SQL anywhere.
- **Errors carry no secrets.** The logger redacts by deny-list; never interpolate a token, header
  or connection string into a message.
- **Naming:** `snake_case` in the database, `camelCase` in TypeScript, `kebab-case` for files.
- **Domain vocabulary is English** in code, even though the instance's data is French. See the
  glossary in [`docs/10-model.md`](docs/10-model.md).

## 5. If you are a workstream agent

1. Read this file, then `docs/40-workstreams/<your-id>.md`, then `docs/50-journal/INDEX.md`.
2. Read any `docs/` spec your brief cites. Do not re-derive a decision that has an ADR.
3. **Work on a branch.** `git switch -c ws/<id>` from up-to-date `main` before you write anything.
   Never commit to `main` — branch protection refuses it. Everything below happens on that branch.
4. Stay inside the directories your brief lists under *Files you may touch*. Other agents are
   working in parallel; wandering outside your tree causes merge conflicts, not just untidiness.
5. When you finish: append `docs/50-journal/<id>-<date>-<slug>.md`, update its `INDEX.md`, and
   update your row in `STATUS.md` (including the PR column) — on your branch, not after.
6. **Open a pull request and get it green.** Fill in
   [the template](.github/pull_request_template.md) in full: what changed, which specs and ADRs it
   honours, every check by name and result, the privacy position, and what you deliberately did not
   do. Then push and watch the checks.
7. **You may not contradict an Accepted ADR.** If your work requires it, write a new ADR proposing
   the supersession and stop for review — implementing against a decided ADR silently is worse than
   being blocked.
8. **You stop when every check on the PR is green, and not before.** Opening the pull request is not
   the end of the job: read its checks back and keep going until every one reports green. A push
   resets that — a green you read before your last commit is not a green. Queued, in progress, or not
   yet reported is **not** green. Red is yours to fix: re-push until it is green. Never weaken a check
   to get past it — a relaxed gate is worse than a red one, because it looks like a pass. The two
   legal endings are *green* and *blocked by an ADR*. **Do not merge your own pull request** — a
   human merges.

The full protocol, including what "all checks pass" means while the check set is still thin:
[`docs/40-workstreams/README.md#pull-requests`](docs/40-workstreams/README.md#pull-requests).

### The journal rule

Journal entries record *what was decided and why*, never what the data said.

- Good: "Adopted 7 unlinked objectives; 2 needed manual matching because titles diverged."
- Bad: anything naming a real objective, project or task.

Debugging notes that genuinely need real values go in a `-private.md` sibling, which is gitignored.

## 6. State of play

[`STATUS.md`](STATUS.md) is the dashboard — phases, workstreams, open decisions. It is maintained
by hand; keep it accurate, it is how the human coordinating this work knows where things are.

`docs/20-decisions/OPEN.md` lists what is undecided and what each open question blocks. If you are
blocked by one, say so in your journal entry rather than guessing.

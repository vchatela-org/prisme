# Agent definitions

One per workstream, so each is spawnable by name:

```
Agent(subagent_type: "w01-domain", prompt: "Execute your workstream brief.")
```

Each definition is deliberately thin. The substance lives in
[`docs/40-workstreams/`](../../docs/40-workstreams/) — an agent's first job is to read its brief.
Keeping it there means one source of truth that a human can also read, rather than a prompt that
drifts from the spec it was copied from.

## Every agent is told to

1. Read `CLAUDE.md`, its `docs/40-workstreams/Wnn-*.md` brief, and `docs/50-journal/INDEX.md`.
2. Cut a branch (`ws/<id>`) from up-to-date `main` and work there. Never commit to `main`.
3. Stay inside the directories its brief lists.
4. Not contradict an Accepted ADR — raise a new one and stop instead.
5. Append a journal entry and update `STATUS.md` when finished, on the branch.
6. Open a pull request filled in from `.github/pull_request_template.md` — features, specs, every
   check by name and result, privacy position, what it did not do.
7. Push until every check is green, fixing what is red. Not green is not finished, and **not
   merging** — a human merges.
8. Never commit real personal data. This repository is public.

The protocol in full: [`docs/40-workstreams/README.md#pull-requests`](../../docs/40-workstreams/README.md#pull-requests).

## Model guidance

| Workstreams | Suggestion |
|---|---|
| W01, W02 | **Most capable model.** Pure logic, cheap to run, everything downstream depends on it |
| W04, W12, W14 | **Most capable model.** They touch real data or the security boundary |
| W03, W13 | Cheaper model — mechanical and well-specified |
| Everything else | Default |

## Scheduling

Waves, parallelism and the one wave that will conflict:
[`docs/30-roadmap.md#scheduling-the-agents`](../../docs/30-roadmap.md#scheduling-the-agents).

Run parallel agents in **separate git worktrees** (`isolation: "worktree"`), one **branch** per
workstream (`ws/<id>`), and land each one as its **own green pull request** — not a merge to `main`.
The worktree keeps two agents out of each other's files; the branch keeps their commits separable
while the PRs go green at different times.

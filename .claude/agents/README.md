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
2. Stay inside the directories its brief lists.
3. Not contradict an Accepted ADR — raise a new one and stop instead.
4. Append a journal entry and update `STATUS.md` when finished.
5. Never commit real personal data. This repository is public.

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

Run parallel agents in **separate git worktrees** (`isolation: "worktree"`) and merge per
workstream.

---
name: w08-ui-focus
description: Builds the Focus, Backlog, Inbox and initiative detail screens - the surfaces used daily. Wave 3, depends on W05 and W07.
---

Execute workstream **W08 · UI — Focus, Backlog, Inbox**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W08-ui-focus.md` — your contract
3. `docs/12-scoring.md` — what the score means and how it is explained
4. `apps/web/CLAUDE.md`
5. The W07 component gallery — **build from it, do not re-invent**
6. `docs/50-journal/INDEX.md`

These are the screens used every day. If "what should I work on now?" is not answerable in three
seconds without thinking, nothing else in prisme matters.

- **Never compute a score in the UI.** It will drift from the domain package and the two will
  disagree in front of the user. Display what the API returns, including `explain`.
- **Guardrails warn and explain; they do not block.** A hard refusal gets worked around, and then
  the model no longer describes reality.
- **Empty states matter.** A first-run empty backlog should explain how to fill it.
- Keyboard-first: navigate, re-score and change status without a mouse.

Build the creation entry points as disabled affordances; W15 wires them.

Fixture data in every screenshot and story. Finish on a branch (`ws/<id>`): the journal entry and
`STATUS.md` row first, then a pull request filled in from `.github/pull_request_template.md`.
**Opening it is not the end: read its checks back until every one reports green** — a push resets
that, and a check that is queued, in progress or not yet reported is not green. Fix what is red and
push again; never weaken a check to get past it. **Do not merge it yourself** — a human merges.

Rules, and what to do at each ending: `docs/40-workstreams/README.md#read-the-checks-back`.

---
name: w03-connectors
description: Builds the read path to the external document and task tools - incremental sync, watermarks, validation, sanitisation, backoff. Wave 1, no dependencies. Mechanical and well-specified.
---

Execute workstream **W03 · Connectors, read path**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W03-connectors.md` — your contract
3. `docs/16-sync.md` — incremental sync and the watermark overlap
4. `packages/connectors/CLAUDE.md`
5. `docs/50-journal/INDEX.md`

Three rules you must not bend:
- **Responses are untrusted input.** Parse every one with Zod before anything else sees it. This
  data contains markup and arbitrary URLs and flows into rendering and into agent context.
- **External stores are addressed by role key**, never by name or ID. No real database name or ID
  may appear in this repository.
- **Never guess a mapping.** An unexpected shape fails the run with a message naming the field.

The classic bug in this workstream: change timestamps round **down** to the minute, so `>= last_run`
misses same-minute edits. Overlap by two minutes and hash content. Without it, sync looks healthy
and quietly loses edits.

No test may call a real API. When recording a fixture, **redact every title, name, ID and URL before
saving** — keep only the shape.

Finish by appending a journal entry and updating your row in `STATUS.md`.

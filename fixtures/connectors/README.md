# Connector fixtures

**Recorded external API responses. Synthetic, and redacted by construction.**

These files are what the contract tests in `packages/connectors` run against. They exist so that
"does the read path still understand the wire format?" is a question a test answers, rather than one
answered by pointing a run at a live workspace — which would fail for the wrong reasons and leak
instance data into git ([`../../docs/17-privacy.md`](../../docs/17-privacy.md)).

## Contents

| File | Shape |
|---|---|
| `task-tool.sync-full.json` | A full sync: projects, sections, labels, tasks nested three deep |
| `task-tool.sync-incremental.json` | An incremental sync, including a deletion and a completion |
| `task-tool.completions.json` | Completion history page 1 of 2 — short, with a `next_cursor`, and with and without recorded durations |
| `task-tool.completions-page2.json` | Page 2, reached by `next_cursor`, with no cursor of its own: the only thing that ends paging |
| `doc-tool.query-objectives.json` | A paged query response, page 1 of 2 |
| `doc-tool.query-objectives-page2.json` | Page 2, reached by `next_cursor` |
| `doc-tool.page.json` | A single page, as `fetchPage` reads it |
| `doc-tool.blocks.json` | That page's block children, one level of nesting |
| `malformed/*.json` | Responses that must **fail**, one per rule worth proving |

## Identifier shapes are deliberately not realistic

Both tools use identifier shapes the privacy deny-list refuses on sight: 32-character hex for the
document tool, long numeric strings for the task tool
([`../../.github/privacy-denylist.txt`](../../.github/privacy-denylist.txt)). Those patterns exist
to catch a real identifier pasted into a file, and a fixture full of realistic-looking fakes would
have forced a hole in the control to be committed alongside it.

So the fixtures use `task-0001`, `doc-page-0001` and similar. Nothing in the read path parses an
external ID — it is an opaque non-empty string on both sides — so the shape is the one part of the
wire format a contract test does not need. Everything else is kept exactly: field names, nesting,
nullability, the `null`-versus-absent distinction, and the rounded-to-the-minute timestamps that the
watermark overlap exists for.

## Vocabulary

Titles and names are borrowed from the rest of [`../`](../README.md) — the same invented areas and
initiatives. A fixture that reads like somebody's actual week is a fixture someone will be tempted
to refresh from production.

## If you record a new one

1. Capture it locally, outside git.
2. **Redact every title, name, ID and URL**, and re-shape the IDs as above.
3. Run `./scripts/privacy-scan.sh`.
4. Only then commit it.

Step 2 is the one that gets skipped under pressure, which is why it is written down in three places.

# Fixtures

**Synthetic data. Entirely invented. The only dataset permitted in documentation, tests,
screenshots and API or MCP examples.**

This repository is public ([`../docs/17-privacy.md`](../docs/17-privacy.md)). Real goals, projects,
tasks, area weights and workspace identifiers never appear in it — not in a test, not in a snapshot,
not in a journal entry, not in a bug reproduction.

If a fixture is missing something you need, **extend the fixture set**. Do not reach for real data
to "make the test realistic".

## Deliberately unlike any real instance

The area list here is six invented areas with invented weights. It does not mirror any real
configuration, and that decoupling is the point — a fixture that resembles the live instance invites
someone to "just update it with the real numbers".

## Contents

| File | Purpose |
|---|---|
| `areas.json` | Six areas plus the Run and Signals lanes, with weights for two years |
| `initiatives.json` | Initiatives across every status, with dependencies and deadlines |
| `objectives.json` | Annual and monthly objectives with key results |
| `scoring/wsjf-balanced.golden.json` | Golden inputs → expected outputs for the shipped method |
| `connectors/` | Recorded external API responses — **redacted before saving** |

## The two-year span is intentional

`areas.json` carries weights for both 2026 and 2027 so that the year-boundary behaviour is testable:
a chart of 2026 must use 2026 weights even after 2027 weights exist. That is the easiest thing to get
wrong in the KPI surface, and the fixture exists so it is caught by a test rather than by disbelief.

## Golden files and versioning

`scoring/*.golden.json` pins scoring inputs to expected outputs. **A diff in a golden file requires
a `version` bump on the scoring method** ([ADR-0006](../docs/20-decisions/0006-pluggable-scoring.md)).
CI enforces the pairing — that check is what keeps method versioning honest rather than aspirational.

## Recording connector fixtures

When capturing a real API response to reproduce a bug:

1. Capture it locally.
2. **Redact before saving**: replace every title, name, ID and URL with synthetic values. Keep the
   *shape* — that is the only part a contract test needs.
3. Confirm the redacted file passes the privacy deny-list scan.
4. Only then commit it.

The unredacted version stays outside git. This step is skipped under pressure more than any other,
which is why it is written down here rather than assumed.

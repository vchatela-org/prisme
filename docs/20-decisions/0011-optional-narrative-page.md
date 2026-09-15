# ADR-0011 · An initiative's narrative page is optional and created on demand

**Status:** Accepted · 2026-09-15

## Context

Some initiatives need a document — research, decisions, notes. Most do not: "fence replaced" needs a
title, a score and a few tasks. Creating a page for every initiative produces a workspace full of
empty pages and makes the ones that matter harder to find.

But when a page *is* wanted, it should be one click, and it should be findable afterwards.

## Decision

The page is **optional and created on demand**. The initiative detail panel offers:

| State | Control |
|---|---|
| No page | **Create page** — creates one from the template and links it |
| Page exists | **Open page** — the button is replaced by a link |
| Page exists elsewhere | **Link existing page** — binds one already written |

## Consequences

- No empty pages; a page's existence signals that there is something written in it.
- "Link existing" is what makes adoption work: pages that predate prisme bind without being
  recreated (ADR-0010).
- The button's state is derived from `external_page_id`, so it is always accurate without extra
  bookkeeping.
- Two paths to page creation — on demand and at project creation — both must respect the
  no-duplicate guards.

## Alternatives

**A page for every initiative.** Uniform and simple. Rejected: clutter, and it makes the workspace
worse in exchange for consistency nobody benefits from.

**Never create pages.** Rejected: some initiatives genuinely need somewhere to think, and forcing
the user to create and link it manually is friction at exactly the wrong moment.

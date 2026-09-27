# FUP · 2026-09-27 · An adoption candidate opens where it lives

**Asked:** the owner, working the adoption queue, could read a candidate's title but not reach the
page behind it. A title alone was not enough to decide: two pages can share one, and the page's
body is what says whether it is an outcome or a note. Finding it meant searching Notion by hand.

## What was there

- The queue rendered each candidate's title as plain text. The candidate already carried the
  identifier the link needs (`externalKind`, `externalId`).
- `DOCTOOL_PAGE_URL_TEMPLATE` and `TASKTOOL_PROJECT_URL_TEMPLATE` already existed, and `pageUrl`
  (`apps/web/src/lib/page-link.ts`) already turned an identifier into a checked link for the
  initiative, Rituals, Settings and Audit screens. Adoption was the one screen naming external
  objects that did not use it.

## What was done

- **`candidateLink`** (`apps/web/src/lib/adoption-view.ts`): a page links through the document-tool
  template, a project through the task-tool template, a section or a task through nothing. It
  returns the tool's name with the address, so the link's accessible name says where it goes. It
  goes through `pageUrl`, so it keeps that function's refusals: no template or an identifier that
  would change the origin gives no link.
- **The adoption screen:** the title is the link, with an external-link icon. It opens in a new tab
  with `rel="noreferrer"`. With no link, the title renders as before.
- **Checked by running it.** The harness ran on a throwaway database with invented candidates of
  each kind and placeholder templates on `example.com`. The two pages and the project rendered as
  links to the substituted addresses. The database was dropped afterwards.

## Decisions taken

- **The title is the link, and there is no separate button.** The row already has three decision
  buttons. A fourth that does not decide anything would sit between them and the thing they decide
  about.
- **A new tab.** The queue is worked row by row, and a link that replaced it would lose the place.
- **Projects too.** It is the same mechanism and the same one line, and the Audit screen already
  links projects that way. It stays inert until the task-tool template is set.

## Follow-ups

- **Not done, deliberately:**
  - **a link for a task.** No template exists for a task-tool task. Adding one is a configuration
    change (`packages/config`), and most candidates of that kind are left as tasks anyway;
  - **naming the proposed entity.** The proposal line still shows the matched prisme entity by
    identifier. Linking it to the initiative screen would help to check a fuzzy match, but the
    identifier's target depends on the proposed kind, which is a separate change.

## Specs touched

`docs/15-runtime.md` (the two template rows, and the paragraph that said only *Open page* read the
page template, which was already stale) · `docs/18-user-guide.md` §2.6.

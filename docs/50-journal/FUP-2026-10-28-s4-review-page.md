# FUP · 2026-10-28 · S4: a review links its page, and copies its summary there

**Agent:** Claude · **Duration:** one run · **PR:** _pending_ · **Outcome:** a review session links the
page in the document tool it was written in, and *Copy summary* puts its artefact on the clipboard to
paste there. Nothing is written outward. S4 is closed.

## What was found first

The API already took `externalPageId` on `PATCH /reviews/:id` and the column existed from 0002, but
no screen set or showed it. The history already rendered a complete written artefact per session
(`artefactFor`: decisions, steps covered and not, the snapshot), with no way to take it anywhere.
The *Reviews* role (`reviews_db`) is `write`-only, and nothing in the repository writes to it.

## What was done

- **The web.** `ReviewPageLink` on the review's last step and on every closed session in *Review
  history*: *Link a page* (a pasted link, parsed by `pageIdFrom`), *Change*, *Unlink*, a link to the
  page when a page URL template is configured, and **Copy summary**, which copies the artefact as
  Markdown. A new server action, `linkReviewPage`, sends `externalPageId`.
- **The API.** No behaviour change; the body field is documented as a reference that can be set after
  the close, and an integration test pins that linking and unlinking a closed session leaves its
  close and snapshot as they were.

## Decisions taken

- **The second *Explore* answer, not the first.** Pushing a page with the decisions and snapshot in its
  body on close would be the first time prisme writes a page *body*. ADR-0030 has the creating path
  send a title and a template and nothing else, on the ground that a body is the document tool's.
  And `reviews_db` is write-only, so ADR-0030 rule 6's duplicate guard, which reads a store's titles
  before creating, cannot run there. Either point needs a decision before code. Linking plus copying
  answers the finding — one record, in the document tool, joined to prisme's — with no outward
  write.
- **Linkable after the close.** The page is often written after the review. Linking changes nothing
  the review decided, and the snapshot is untouched.
- **Copied by the person, not sent.** The clipboard is the one channel that writes nothing on prisme's
  behalf. The artefact is the same text the history already shows, so what is pasted is what was
  recorded.

## Checks run locally

Node 24.21.0 (the repo pins 26; CI runs that): root `pnpm typecheck`; the whole `unit` project (2290);
the API's `integration.test.ts` (82, one new); eslint and prettier on the changed files; the privacy
scan with the local supplement.

## Not done

- No automatic push to `reviews_db`. It needs an ADR on prisme writing a review page's body and on
  the duplicate guard for a write-only store.
- No MCP tool links a review's page.

## Specs touched

- `docs/10-model.md` §10, `docs/11-ownership.md` §9, `docs/18-user-guide.md` §2.3 and §4,
  `docs/19-how-it-works.md` S4.

# FUP · 2026-10-28 · S13: the map of the objects is linked where its questions are asked

**Agent:** Claude · **Duration:** one run · **PR:** [#198](https://github.com/vchatela-org/prisme/pull/198) · **Outcome:** Settings' overview and the
Adoption screen link to `docs/19-how-it-works.md`, at the version that is running; the user guide's
introduction points to it. S13 is closed.

## What was done

- `docsUrl(document, version)` and `HOW_IT_WORKS` in `apps/web/src/lib/docs-link.ts` (+ tests): the
  public repository's document at the image's tag (`APP_VERSION`, `vX.Y.Z`), or `main` for a
  development build.
- Settings' header and the Adoption header each carry a *How prisme works* link.
- `docs/18-user-guide.md`'s introduction names the document beside the vision and the specs.

## Decisions taken

- **The tag, not `main`.** A document read from `main` can describe a feature the running image does
  not have yet; the tag is the document that shipped with it.
- **The public repository, linked rather than served.** The web tier does not bundle the docs, and a
  second copy would drift from the one reviewed in pull requests. The URL names the product's own
  repository and nothing about an instance; the privacy scan is clean with the local supplement.

## Checks run locally

Node 24.21.0: `apps/web` typecheck, `docs-link.test.ts`, the whole `unit` project, eslint and prettier
on the changed files, the privacy scan with the local supplement.

## Specs touched

- `docs/18-user-guide.md` (introduction), `docs/19-how-it-works.md` S13.

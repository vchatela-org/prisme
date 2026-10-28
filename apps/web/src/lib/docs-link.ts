/**
 * A link to one of prisme's own documents, at the version that is running (S13).
 *
 * The specification lives in the public repository, and `docs/19-how-it-works.md`
 * is the one map of the objects — which object a thing should become, which
 * door it comes in by, how they connect. The screens that ask those questions
 * (Settings' overview, Adoption) link to it.
 *
 * A published image carries its tag (`APP_VERSION`, `v0.17.0`), and the link
 * names that tag, so the document describes the build in front of the reader;
 * a development build links to `main`. The repository is the product's own and
 * public — nothing about an instance is in this URL.
 */
const REPOSITORY = 'https://github.com/vchatela-org/prisme';

const TAG = /^v\d+\.\d+\.\d+$/;

export function docsUrl(document: string, version: string): string {
  const ref = TAG.test(version) ? version : 'main';
  return `${REPOSITORY}/blob/${ref}/docs/${document}`;
}

/** The map of the objects: what becomes what, and how they connect. */
export const HOW_IT_WORKS = '19-how-it-works.md';

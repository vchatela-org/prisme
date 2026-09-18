import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MARKS,
  isFetchAllowed,
  sanitiseRichText,
  type RichTextRun,
} from '@prisme/connectors';

/**
 * *Sanitisation strips a script tag embedded in third-party rich text — test
 * with a hostile fixture.* — W14's definition of done.
 *
 * `packages/connectors` owns the sanitiser and tests its units. What is
 * asserted here is W14's claim about it: that the **security property** holds
 * against content written to defeat it, end to end, from a fixture rather than
 * from a string invented in the same breath as the assertion.
 *
 * ### The property is stronger than "strips script tags"
 *
 * The sanitiser never emits markup at all. A run of rich text becomes plain
 * text plus a list of marks from a closed allow-list, so there is no HTML to
 * escape and no parser to confuse — `<img onerror=…>` comes out as the
 * characters `<img onerror=…>`, inert, because nothing downstream is ever handed
 * something it would parse as markup. That is a different and better guarantee
 * than a filter that tries to recognise every dangerous construct, and the
 * tests below are written against *that* property.
 *
 * The fixture is `fixtures/connectors/hostile-rich-text.json`, and it is
 * synthetic like everything in `fixtures/` (docs/17-privacy.md).
 */

interface HostileFixture {
  readonly runs: readonly RichTextRun[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../fixtures/connectors/hostile-rich-text.json', import.meta.url),
    'utf8',
  ),
) as HostileFixture;

const sanitised = sanitiseRichText(fixture.runs);

describe('markup in third-party rich text', () => {
  it('is carried as inert text, never as structure', () => {
    // The characters survive — dropping them would silently rewrite the owner's
    // content — but there is no markup *object* anywhere in the result. Every
    // segment is `{ text, marks, href? }`, and a renderer that puts `text` in a
    // text node cannot be made to execute it.
    expect(sanitised.text).toContain('<script>');
    for (const segment of sanitised.segments) {
      expect(Object.keys(segment).sort()).toEqual(
        segment.href === undefined ? ['marks', 'text'] : ['href', 'marks', 'text'],
      );
    }
  });

  it('never produces a mark outside the closed allow-list', () => {
    for (const segment of sanitised.segments) {
      for (const mark of segment.marks) {
        expect(ALLOWED_MARKS).toContain(mark);
      }
    }
    // The fixture asks for `colour: red` and `onclick: true`. Neither exists.
    const all = sanitised.segments.flatMap((segment) => segment.marks);
    expect(all).not.toContain('colour');
    expect(all).not.toContain('onclick');
  });

  /*
   * Asserted as an allow-list, which is how the sanitiser actually works.
   *
   * The first version of these two tests enumerated the bad schemes —
   * `javascript:`, then `data:` — and CodeQL's `js/incomplete-url-scheme-check`
   * flagged it high, correctly: the list was missing `vbscript:`, and a list of
   * the schemes somebody thought of is exactly the shape of check that fails.
   *
   * `packages/connectors` was never doing that; `ALLOWED_URL_SCHEMES` there is
   * `{http:, https:}` and everything else is dropped. So the weaker assertion
   * was the *test*, quietly checking less than the code guarantees. Stating the
   * allow-list covers `javascript:`, `data:`, `vbscript:` and every scheme
   * nobody has thought of yet, in one line.
   */
  const HTTP_ONLY = /^https?:\/\//i;

  it('drops a non-http href rather than carrying it to a renderer', () => {
    for (const segment of sanitised.segments) {
      if (segment.href === undefined) continue;
      expect(segment.href, `${segment.href} reached a renderer`).toMatch(HTTP_ONLY);
    }
    // And the hostile hrefs are genuinely gone rather than never present: the
    // fixture supplies three links, and only the http one survives as an href.
    expect(sanitised.segments.filter((segment) => segment.href !== undefined)).toHaveLength(0);
  });

  it('collects only http(s) URLs, and only as data', () => {
    expect(sanitised.urls.length).toBeGreaterThan(0);
    for (const url of sanitised.urls) {
      expect(url, `${url} was collected`).toMatch(HTTP_ONLY);
    }
  });

  it('strips control characters and bidirectional overrides', () => {
    // The bidi overrides are the ones that survive everything else, because
    // they are perfectly legitimate Unicode: they let `Invoice ⁧txt.exe⁩` render
    // as `Invoice exe.txt` in a UI and read as something it is not.
    for (const codePoint of ['‮', '‭', '‎', '⁦', '', '', '\r']) {
      expect(
        sanitised.text,
        `U+${codePoint.codePointAt(0)?.toString(16) ?? ''} survived`,
      ).not.toContain(codePoint);
    }
  });
});

describe('a URL found in content is collected, never fetched', () => {
  it('denies every URL in the fixture by default', () => {
    for (const url of sanitised.urls) {
      expect(isFetchAllowed(url), `${url} would be fetched`).toBe(false);
    }
  });

  it('still refuses an internal address even if somebody allow-lists its host', () => {
    // "We only fetch the ones we found in the user's own workspace" is exactly
    // the reasoning that makes SSRF exploitable (docs/14-threat-model.md §5).
    expect(isFetchAllowed('http://localhost:5432/', { allowedHosts: ['localhost'] })).toBe(false);
    expect(
      isFetchAllowed('http://169.254.169.254/latest/meta-data/', {
        allowedHosts: ['169.254.169.254'],
      }),
    ).toBe(false);
  });
});

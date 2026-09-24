import { describe, expect, it } from 'vitest';
import { pageUrl } from './page-link.js';

/**
 * The two hostnames here are invented and reserved for documentation. A real
 * one is instance data and belongs in the environment, which is the whole point
 * of the variable this function reads (docs/17-privacy.md §1).
 */
const TEMPLATE = 'https://workspace.example.com/page/{id}';
const PAGE_ID = 'a1b2c3d4e5f60718';

describe('linking to a page', () => {
  it('substitutes the identifier into the operator’s template', () => {
    expect(pageUrl(TEMPLATE, PAGE_ID)).toBe('https://workspace.example.com/page/a1b2c3d4e5f60718');
  });

  it('leaves any other placeholder alone rather than percent-encoding it', () => {
    // `new URL` turns braces into `%7B`/`%7D`, so a link read back through
    // `.href` would mangle a template that carries a second placeholder. The
    // value is validated through `URL` and returned as written.
    expect(pageUrl('https://workspace.example.com/{id}?view={view}', PAGE_ID)).toBe(
      'https://workspace.example.com/a1b2c3d4e5f60718?view={view}',
    );
  });

  it('is undefined with no template, which is every instance’s default', () => {
    expect(pageUrl(undefined, PAGE_ID)).toBeUndefined();
  });

  it('is undefined with no page, because there is nothing to link to', () => {
    expect(pageUrl(TEMPLATE, null)).toBeUndefined();
    expect(pageUrl(TEMPLATE, '   ')).toBeUndefined();
  });

  it('refuses a template with no placeholder, rather than linking every page to one', () => {
    // The loader refuses this too. It is checked here as well so the function
    // does not depend on who called it — a screen that reached it another way
    // would otherwise render the same link for every initiative.
    expect(pageUrl('https://workspace.example.com/pages', PAGE_ID)).toBeUndefined();
  });

  it('refuses an identifier that would choose the host', () => {
    // A page id is not a subdomain, and an identifier arriving from the
    // document tool is third-party data. If the template puts `{id}` in the
    // authority, the id decides which site the link points at — so there is no
    // link rather than a plausible-looking one.
    expect(pageUrl('https://{id}.example.com/page', PAGE_ID)).toBeUndefined();
  });

  it('refuses a template that is not http(s), even though the loader would refuse it first', () => {
    expect(pageUrl('javascript:alert(1)/{id}', PAGE_ID)).toBeUndefined();
    expect(pageUrl('ftp://workspace.example.com/{id}', PAGE_ID)).toBeUndefined();
  });

  it('is undefined when the identifier cannot be part of a URL at all', () => {
    // `new URL` refuses a bare word here; a link that cannot be parsed is not a
    // link, and rendering the raw string as an href would be worse than
    // rendering nothing.
    expect(pageUrl('workspace.example.com/{id}', PAGE_ID)).toBeUndefined();
  });
});

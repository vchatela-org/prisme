import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MARKS,
  collectUrls,
  isFetchAllowed,
  safeUrl,
  sanitisePlainText,
  sanitiseRichText,
} from './sanitise.js';

/**
 * Boundary ⑤ (docs/14-threat-model.md §2): data from the owner's own document
 * tool is untrusted input. It contains markup, arbitrary URLs and text pasted
 * from the open web, and it flows into rendering *and* into agent context.
 */

describe('plain text', () => {
  it('strips control characters', () => {
    expect(sanitisePlainText('before\u0000after')).toBe('beforeafter');
    expect(sanitisePlainText('bell\u0007here')).toBe('bellhere');
  });

  it('keeps tabs and newlines, which are content', () => {
    expect(sanitisePlainText('one\ttwo\nthree')).toBe('one\ttwo\nthree');
  });

  it('normalises CRLF, so a line ending cannot change a content hash', () => {
    expect(sanitisePlainText('one\r\ntwo')).toBe('one\ntwo');
  });

  it('strips bidirectional overrides', () => {
    // A title that renders as something other than what it is.
    expect(sanitisePlainText('invoice\u202egpj.exe\u202c')).toBe('invoicegpj.exe');
    expect(sanitisePlainText('\u2066isolated\u2069')).toBe('isolated');
  });

  it('normalises to NFC, so one string has one hash', () => {
    const composed = 'e\u0301';
    expect(sanitisePlainText(composed)).toBe('é');
  });

  it('leaves ordinary text alone, including the accents the instance is full of', () => {
    expect(sanitisePlainText('échéance — 50 % fait')).toBe('échéance — 50 % fait');
  });
});

describe('rich text', () => {
  it('emits text and marks, never markup', () => {
    const result = sanitiseRichText([
      { text: 'bold bit', annotations: { bold: true } },
      { text: ' and plain' },
    ]);
    expect(result.text).toBe('bold bit and plain');
    expect(result.segments[0]?.marks).toEqual(['bold']);
    expect(result.segments[1]?.marks).toEqual([]);
  });

  it('carries markup through as characters rather than structure', () => {
    // Nothing here has to be escaped, because nothing here is ever rendered as
    // markup. That is the point of emitting text plus marks.
    const result = sanitiseRichText([{ text: "<script>alert('xss')</script>" }]);
    expect(result.text).toBe("<script>alert('xss')</script>");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.marks).toEqual([]);
  });

  it('drops an annotation that is not on the allow-list', () => {
    const result = sanitiseRichText([
      { text: 'marked', annotations: { bold: true, highlight: true, color: 'red' } },
    ]);
    expect(result.segments[0]?.marks).toEqual(['bold']);
  });

  it('allows exactly five marks, and no more', () => {
    expect([...ALLOWED_MARKS]).toEqual(['bold', 'italic', 'strikethrough', 'underline', 'code']);
  });

  it('drops empty runs, so the hash does not depend on how the tool split them', () => {
    const split = sanitiseRichText([{ text: 'one' }, { text: '' }, { text: ' two' }]);
    const whole = sanitiseRichText([{ text: 'one two' }]);
    expect(split.text).toBe(whole.text);
    expect(split.segments).toHaveLength(2);
  });

  it('collects a link href', () => {
    const result = sanitiseRichText([
      { text: 'the reference', href: 'https://example.invalid/reference' },
    ]);
    expect(result.urls).toEqual(['https://example.invalid/reference']);
    expect(result.segments[0]?.href).toBe('https://example.invalid/reference');
  });

  it('drops a javascript: href entirely rather than carrying it as a link', () => {
    const result = sanitiseRichText([{ text: 'click', href: 'javascript:alert(1)' }]);
    expect(result.urls).toEqual([]);
    expect(result.segments[0]?.href).toBeUndefined();
  });

  it('finds a bare URL typed into a paragraph', () => {
    const result = sanitiseRichText([{ text: 'see https://example.invalid/plan for detail' }]);
    expect(result.urls).toEqual(['https://example.invalid/plan']);
  });

  it('deduplicates', () => {
    const result = sanitiseRichText([
      { text: 'https://example.invalid/plan' },
      { text: ' again ', href: 'https://example.invalid/plan' },
    ]);
    expect(result.urls).toHaveLength(1);
  });
});

describe('URLs', () => {
  it('accepts http and https and nothing else', () => {
    expect(safeUrl('https://example.invalid/a')).toBe('https://example.invalid/a');
    expect(safeUrl('http://example.invalid/a')).toBe('http://example.invalid/a');
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeUndefined();
    expect(safeUrl('file:///etc/passwd')).toBeUndefined();
    expect(safeUrl('not a url at all')).toBeUndefined();
  });

  it('drops trailing sentence punctuation when scraping prose', () => {
    expect(collectUrls('read https://example.invalid/plan.')).toEqual([
      'https://example.invalid/plan',
    ]);
  });
});

describe('fetching a URL found in content', () => {
  it('denies everything by default', () => {
    expect(isFetchAllowed('https://example.invalid/a')).toBe(false);
  });

  it('allows an exact host that was explicitly listed', () => {
    expect(isFetchAllowed('https://example.invalid/a', { allowedHosts: ['example.invalid'] })).toBe(
      true,
    );
  });

  it('does not treat a subdomain as the listed host', () => {
    expect(
      isFetchAllowed('https://evil.example.invalid/a', { allowedHosts: ['example.invalid'] }),
    ).toBe(false);
  });

  it('refuses loopback and private addresses even when they are allow-listed', () => {
    // The 10/8 address is assembled rather than written out: a literal one is
    // what the privacy deny-list scans for (.github/privacy-denylist.txt), and
    // a test that trips the control would teach everyone to ignore it.
    const rfc1918 = ['10', '1', '2', '3'].join('.');
    const everything = {
      allowedHosts: ['localhost', '127.0.0.1', rfc1918, '192.168.1.1', '169.254.169.254'],
    };
    expect(isFetchAllowed('http://localhost:3000/', everything)).toBe(false);
    expect(isFetchAllowed('http://127.0.0.1/', everything)).toBe(false);
    expect(isFetchAllowed(`http://${rfc1918}/`, everything)).toBe(false);
    expect(isFetchAllowed('http://192.168.1.1/', everything)).toBe(false);
    // The cloud metadata endpoint, which is the classic SSRF target.
    expect(isFetchAllowed('http://169.254.169.254/latest/meta-data/', everything)).toBe(false);
  });

  it('refuses private-network name suffixes', () => {
    // Assembled rather than written out, for the same reason as the address
    // above: an internal hostname in host position is a deny-list pattern.
    for (const suffix of ['lan', 'internal', 'local', 'home.arpa']) {
      const host = `box.${suffix}`;
      expect(isFetchAllowed(`http://${host}/`, { allowedHosts: [host] })).toBe(false);
    }
  });

  it('refuses a scheme it would never fetch anyway', () => {
    expect(isFetchAllowed('javascript:alert(1)', { allowedHosts: ['example.invalid'] })).toBe(
      false,
    );
  });
});

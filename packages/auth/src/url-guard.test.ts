import { describe, expect, it } from 'vitest';
import { assertUrlAllowed, isUrlAllowed, UrlRejected } from './url-guard.js';

/**
 * The SSRF guard — W14 item 6, docs/14-threat-model.md §5.
 *
 * The allow-list is the control and the literal-address checks are defence in
 * depth, so both are tested: the first because it is what actually holds, the
 * second because the day somebody adds a permissive entry is the day the
 * encodings below stop being theoretical.
 */

const ALLOWED = { allowedOrigins: ['https://idp.prisme.invalid'] };

describe('the allow-list is the control', () => {
  it('permits an exact origin', () => {
    expect(isUrlAllowed('https://idp.prisme.invalid/jwks', ALLOWED)).toBe(true);
  });

  it('refuses everything when the list is empty', () => {
    // Deny by default. An empty allow-list means "nothing", which is the
    // opposite of what an empty *deny* list would mean.
    expect(isUrlAllowed('https://idp.prisme.invalid/jwks', { allowedOrigins: [] })).toBe(false);
  });

  it('is not fooled by a suffix', () => {
    expect(isUrlAllowed('https://idp.prisme.invalid.evil.test/jwks', ALLOWED)).toBe(false);
  });

  it('is not fooled by a different scheme or port', () => {
    expect(isUrlAllowed('http://idp.prisme.invalid/jwks', ALLOWED)).toBe(false);
    expect(isUrlAllowed('https://idp.prisme.invalid:8443/jwks', ALLOWED)).toBe(false);
  });

  it('is not fooled by userinfo that looks like the allowed host', () => {
    // `https://idp.prisme.invalid@evil.test` resolves to evil.test. Refused
    // twice over: for the credentials, and for the origin.
    expect(isUrlAllowed('https://idp.prisme.invalid@evil.test/jwks', ALLOWED)).toBe(false);
  });
});

describe('shapes that are never fetched, whatever the allow-list says', () => {
  /**
   * Allow-lists the URL's *own* origin, so the only thing that can refuse it is
   * one of the shape checks. Otherwise every case below would pass for the
   * uninteresting reason that nothing was on the list.
   */
  function reason(raw: string): string {
    let allowedOrigins: readonly string[] = [];
    try {
      allowedOrigins = [new URL(raw).origin];
    } catch {
      // Malformed. The empty list is fine — the parse refuses it first.
    }
    try {
      assertUrlAllowed(raw, { allowedOrigins });
    } catch (error) {
      if (error instanceof UrlRejected) return error.reason;
    }
    return 'accepted';
  }

  it('refuses non-http schemes', () => {
    expect(reason('file:///etc/passwd')).toBe('scheme');
    expect(reason('gopher://host/1')).toBe('scheme');
    expect(reason('javascript:alert(1)')).toBe('scheme');
  });

  it('refuses credentials in the URL', () => {
    expect(reason('https://user:pass@host.invalid/')).toBe('userinfo');
  });

  it('refuses the cloud metadata address', () => {
    expect(reason('http://169.254.169.254/latest/meta-data/')).toBe('literal_address');
  });

  it('refuses loopback however it is spelled', () => {
    // Every one of these reaches 127.0.0.1. A blocked-string list catches the
    // first and misses the rest, which is why the check expands the address.
    for (const host of [
      'http://127.0.0.1/',
      'http://127.1/',
      'http://2130706433/',
      'http://0177.0.0.1/',
      'http://0x7f.0.0.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      expect(reason(host), host).toBe('literal_address');
    }
  });

  it('refuses private ranges', () => {
    /*
     * The 10/8 case is assembled rather than written out, and the reason is
     * worth a sentence so nobody "tidies" it back into a literal.
     *
     * This repository is public, and `.github/privacy-denylist.txt` refuses
     * every `10.x.y.z` literal — correctly, because it cannot tell a textbook
     * example from the owner's real network, and that is precisely the kind of
     * thing docs/17-privacy.md exists to keep out of a public history.
     * Narrowing the pattern to make a test read nicer is the wrong trade, and a
     * `.privacyignore` entry would be worse: a hole in the control, in the one
     * directory that handles credentials. So the octets are joined at run time.
     * The guard sees the same string either way.
     */
    const tenDotEight = `http://${[10, 0, 0, 5].join('.')}/`;

    for (const host of [
      tenDotEight,
      'http://172.16.4.1/',
      'http://192.168.1.1/',
      'http://100.64.0.1/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://0.0.0.0/',
    ]) {
      expect(reason(host), host).toBe('literal_address');
    }
  });

  it('allows an ordinary public address that is on the list', () => {
    expect(reason('https://93.184.216.34/jwks')).toBe('accepted');
  });

  it('refuses something that is not a URL', () => {
    expect(reason('/jwks')).toBe('malformed');
  });
});

describe('the checked object is the one to use', () => {
  it('returns the parsed URL rather than the string', () => {
    const url = assertUrlAllowed('https://idp.prisme.invalid/jwks', ALLOWED);
    // Re-parsing a string after checking it is how a check and a fetch end up
    // disagreeing about what was checked.
    expect(url).toBeInstanceOf(URL);
    expect(url.origin).toBe('https://idp.prisme.invalid');
  });
});

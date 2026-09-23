import type { OidcConfig } from '@prisme/config';
import { describe, expect, it } from 'vitest';
import {
  authorizationUrl,
  codeChallenge,
  cookieValue,
  createFlowSecrets,
  endSessionUrl,
  exchangeCode,
  OidcExchangeFailed,
  parseCallback,
  parseStateCookie,
  returnToPath,
  sameSecret,
  serializeStateCookie,
  withoutCookie,
} from './oidc';

/**
 * The flow's mechanics.
 *
 * Nothing here is a real endpoint: `exchangeCode` takes its `fetch` as an
 * option, which is the same shape `@prisme/auth`'s key-set resolution uses and
 * for the same reason — a test may drive the exchange without a socket, and no
 * test in this repository may call a real API.
 *
 * The configuration below is a fixture: an `.invalid` host, per
 * `docs/17-privacy.md`. No real issuer, client id or callback URL appears
 * anywhere in this repository.
 */

const CONFIG: OidcConfig = {
  clientId: 'prisme-example-client',
  redirectUri: 'https://prisme.example.com/auth/callback',
  authorizationEndpoint: 'https://idp.example.com/application/o/authorize/',
  tokenEndpoint: 'https://idp.example.com/application/o/token/',
  endSessionEndpoint: undefined,
  scopes: ['openid', 'profile', 'email'],
};

describe('PKCE', () => {
  it('derives the challenge exactly as RFC 7636 Appendix B does', () => {
    // The specification's own worked example. If this ever fails, the login has
    // started sending a challenge no provider will accept the verifier for, and
    // the symptom is a plain `invalid_grant` at the token endpoint.
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('mints a verifier in the unreserved set, at the length RFC 7636 requires', () => {
    const { verifier } = createFlowSecrets();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(verifier).toHaveLength(43);
  });

  it('mints a fresh state and verifier every time', () => {
    const first = createFlowSecrets();
    const second = createFlowSecrets();
    expect(first.state).not.toBe(second.state);
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).not.toBe(second.challenge);
  });

  it('compares two equal secrets as equal, and two of different lengths without throwing', () => {
    expect(sameSecret('a'.repeat(43), 'a'.repeat(43))).toBe(true);
    expect(sameSecret('a'.repeat(43), 'a'.repeat(44))).toBe(false);
    expect(sameSecret('', 'x')).toBe(false);
  });
});

describe('the authorization request', () => {
  const flow = { state: 'the-state', verifier: 'the-verifier', challenge: 'the-challenge' };

  it('carries the code flow, PKCE S256, and the configured client', () => {
    const url = authorizationUrl(CONFIG, flow);
    expect(url.origin + url.pathname).toBe('https://idp.example.com/application/o/authorize/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'prisme-example-client',
      redirect_uri: 'https://prisme.example.com/auth/callback',
      scope: 'openid profile email',
      state: 'the-state',
      code_challenge: 'the-challenge',
      code_challenge_method: 'S256',
    });
  });

  it('sends no client secret, because there is none to send', () => {
    // The property ADR-0026 rule 4 buys: a public client, so nothing prisme
    // holds can mint a token at the provider.
    const url = authorizationUrl(CONFIG, flow);
    expect(url.searchParams.has('client_secret')).toBe(false);
    for (const value of url.searchParams.values()) expect(value).not.toMatch(/secret/i);
  });
});

describe('parseCallback', () => {
  it('accepts a code and a state', () => {
    expect(parseCallback(new URLSearchParams('code=abc&state=xyz'))).toEqual({
      kind: 'code',
      code: 'abc',
      state: 'xyz',
    });
  });

  it('surfaces the provider’s error code', () => {
    expect(parseCallback(new URLSearchParams('error=access_denied'))).toEqual({
      kind: 'error',
      error: 'access_denied',
    });
  });

  it('does not carry an arbitrary error value into a message', () => {
    // A query parameter is attacker-controlled text, and this one reaches a log
    // line.
    const hostile = parseCallback(
      new URLSearchParams(`error=${encodeURIComponent('<img src=x onerror=alert(1)>')}`),
    );
    expect(hostile).toEqual({ kind: 'error', error: 'unrecognised_error' });
  });

  it.each([
    ['nothing at all', ''],
    ['a code with no state', 'code=abc'],
    ['a state with no code', 'state=xyz'],
    ['an empty code', 'code=&state=xyz'],
  ])('refuses %s', (_label, query) => {
    expect(parseCallback(new URLSearchParams(query))).toMatchObject({ kind: 'error' });
  });
});

describe('cookies', () => {
  it('finds one value among several, and trims the whitespace browsers emit', () => {
    expect(cookieValue('a=1; __Host-prisme_session=the-token ; b=2', '__Host-prisme_session')).toBe(
      'the-token',
    );
  });

  it('does not match a name it merely contains', () => {
    expect(cookieValue('x__Host-prisme_session=nope', '__Host-prisme_session')).toBeUndefined();
  });

  it.each([undefined, null, '', 'other=1'])('returns undefined for %s', (header) => {
    expect(cookieValue(header, '__Host-prisme_session')).toBeUndefined();
  });

  it('survives a value whose percent-escape is malformed', () => {
    // A malformed cookie is an authentication failure, not a 500.
    expect(cookieValue('session=abc%', 'session')).toBe('abc%');
  });

  it('removes one cookie from the header and keeps the rest', () => {
    expect(
      withoutCookie('theme=dark; __Host-prisme_session=secret; other=1', '__Host-prisme_session'),
    ).toBe('theme=dark; other=1');
  });

  it('returns undefined once the header is empty, so the caller can drop it entirely', () => {
    expect(withoutCookie('__Host-prisme_session=secret', '__Host-prisme_session')).toBeUndefined();
    expect(withoutCookie(undefined, '__Host-prisme_session')).toBeUndefined();
  });
});

describe('returnToPath', () => {
  it('keeps a path, query string and all', () => {
    expect(returnToPath('/backlog?area=craft')).toBe('/backlog?area=craft');
  });

  it.each([
    ['an absolute URL', 'https://evil.example.com/'],
    ['a protocol-relative URL', '//evil.example.com/'],
    ['a backslash, which some browsers normalise to a slash', '/\\evil.example.com'],
    ['a control character', '/a\u0000b'],
    ['an empty value', ''],
    ['a value that is not a path at all', 'backlog'],
    [null, undefined],
  ])('sends %s to the Focus screen instead', (_label, value) => {
    expect(returnToPath(value)).toBe('/');
  });
});

describe('the in-flight state', () => {
  it('round-trips', () => {
    const payload = { state: 's', verifier: 'v', returnTo: '/timeline' };
    expect(parseStateCookie(serializeStateCookie(payload))).toEqual(payload);
  });

  it.each([
    ['not JSON', 'nonsense'],
    ['JSON of the wrong shape', '{"state":"s"}'],
    ['an empty value', ''],
  ])('refuses %s rather than crashing', (_label, value) => {
    expect(parseStateCookie(value)).toBeUndefined();
  });
});

describe('endSessionUrl', () => {
  it('is absent when the deployment configured no end-session endpoint', () => {
    expect(endSessionUrl(CONFIG)).toBeUndefined();
  });

  it('names the client, so a provider that requires one does not error after logging out', () => {
    expect(
      endSessionUrl({
        ...CONFIG,
        endSessionEndpoint: 'https://idp.example.com/application/o/end-session/',
      }),
    ).toBe('https://idp.example.com/application/o/end-session/?client_id=prisme-example-client');
  });
});

describe('exchangeCode', () => {
  const call = { config: CONFIG, code: 'the-code', verifier: 'the-verifier' };

  interface Sent {
    readonly url: string;
    readonly init: RequestInit;
  }

  /** A `fetch` that answers with `body` and remembers what it was asked. */
  function respond(body: string, status = 200): { fetch: typeof globalThis.fetch; sent: Sent[] } {
    const sent: Sent[] = [];
    const fetchImpl = (url: string, init: RequestInit): Promise<Response> => {
      sent.push({ url, init });
      return Promise.resolve(new Response(body, { status }));
    };
    return { fetch: fetchImpl as unknown as typeof globalThis.fetch, sent };
  }

  it('redeems the code with the verifier, and with no client secret', async () => {
    const { fetch: fetchImpl, sent } = respond(
      JSON.stringify({ id_token: 'the-id-token', access_token: 'ignored' }),
    );

    await expect(exchangeCode({ ...call, fetch: fetchImpl })).resolves.toBe('the-id-token');

    const [first] = sent;
    expect(first?.url).toBe('https://idp.example.com/application/o/token/');
    expect(first?.init.method).toBe('POST');
    expect((first?.init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const form = new URLSearchParams(first?.init.body as string);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://prisme.example.com/auth/callback',
      client_id: 'prisme-example-client',
      code_verifier: 'the-verifier',
    });
    expect(form.has('client_secret')).toBe(false);
  });

  it.each([
    ['a body with no id token', JSON.stringify({ access_token: 'only-an-access-token' })],
    ['an HTML body, which is what a proxy in the way returns', '<html>502</html>'],
    ['an empty body', ''],
  ])('refuses %s', async (_label, body) => {
    await expect(exchangeCode({ ...call, fetch: respond(body).fetch })).rejects.toBeInstanceOf(
      OidcExchangeFailed,
    );
  });

  it('carries the provider’s OAuth2 error code into the reason', async () => {
    const { fetch: fetchImpl } = respond(JSON.stringify({ error: 'invalid_grant' }), 400);
    await expect(exchangeCode({ ...call, fetch: fetchImpl })).rejects.toMatchObject({
      status: 400,
      reason: 'invalid_grant',
    });
  });

  it('does not carry an arbitrary error value into the reason, or the body into the message', async () => {
    const { fetch: fetchImpl } = respond(
      JSON.stringify({ error: '<script>alert(1)</script>', access_token: 'leaked' }),
      400,
    );
    let thrown: OidcExchangeFailed | undefined;
    try {
      await exchangeCode({ ...call, fetch: fetchImpl });
    } catch (error) {
      thrown = error as OidcExchangeFailed;
    }
    expect(thrown?.reason).toBe('unrecognised_error');
    expect(thrown?.message).not.toContain('leaked');
    expect(thrown?.message).not.toContain('<script>');
  });

  it('reports an unreachable endpoint without naming it', async () => {
    const fetchImpl = (): Promise<Response> =>
      Promise.reject(new TypeError('fetch failed: https://idp.example.com/application/o/token/'));

    let thrown: OidcExchangeFailed | undefined;
    try {
      await exchangeCode({ ...call, fetch: fetchImpl });
    } catch (error) {
      thrown = error as OidcExchangeFailed;
    }
    expect(thrown?.reason).toBe('unreachable');
    // The endpoint is deployment detail and a fetch failure message carries it.
    expect(thrown?.message).not.toContain('idp.example.com');
  });
});

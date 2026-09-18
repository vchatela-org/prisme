import { beforeAll, describe, expect, it } from 'vitest';
import { assertKeySetUsable, discoverJwksUrl, resolveKeySet } from './jwks.js';
import { createTestKeys, TEST_ISSUER, type TestKeys } from './test-support.js';

/**
 * **Boot fails when the key set cannot verify anything.**
 *
 * The brief calls this "the one failure that would otherwise look like a
 * working system", and it is not hypothetical: the target identity provider,
 * deployed the ordinary way, has no signing keypair, signs with the client
 * secret and publishes `{}`. Nothing in that is an error at any layer — which
 * is precisely why prisme has to make it one.
 */

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});

/** A fetch that answers a fixed map of URLs, and nothing else. */
function fetcher(routes: Record<string, unknown>, status = 200): typeof globalThis.fetch {
  return ((input: URL | RequestInfo) => {
    const url = input instanceof URL ? input.toString() : String(input);
    const body = routes[url];
    if (body === undefined) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof globalThis.fetch;
}

const JWKS_URL = `${TEST_ISSUER}/jwks`;
const DISCOVERY_URL = `${TEST_ISSUER}/.well-known/openid-configuration`;

describe('the boot check', () => {
  it('accepts a key set with a usable asymmetric key', async () => {
    await expect(
      assertKeySetUsable(new URL(JWKS_URL), fetcher({ [JWKS_URL]: keys.jwks })),
    ).resolves.toBeUndefined();
  });

  it('refuses an empty key set — the provider-with-no-keypair default', async () => {
    await expect(
      assertKeySetUsable(new URL(JWKS_URL), fetcher({ [JWKS_URL]: {} })),
    ).rejects.toThrow(/holds no usable asymmetric key/);
  });

  it('refuses a key set holding only a shared secret', async () => {
    // `oct` is a symmetric key. A provider that publishes one is telling you it
    // is HMAC-signing, which is exactly the case the alg allow-list refuses at
    // request time — and which should never have got as far as a request.
    await expect(
      assertKeySetUsable(
        new URL(JWKS_URL),
        fetcher({ [JWKS_URL]: { keys: [{ kty: 'oct', k: 'ignored' }] } }),
      ),
    ).rejects.toThrow(/holds no usable asymmetric key/);
  });

  it('refuses a key set that cannot be read at all', async () => {
    await expect(assertKeySetUsable(new URL(JWKS_URL), fetcher({}))).rejects.toThrow(
      /could not be read/,
    );
  });

  it('says what is almost certainly wrong, in the message', async () => {
    // The failure is a deployment obligation (docs/15-runtime.md §6, item 1),
    // and the message is the only place anybody will look.
    await expect(
      assertKeySetUsable(new URL(JWKS_URL), fetcher({ [JWKS_URL]: {} })),
    ).rejects.toThrow(/no signing keypair/);
  });
});

describe('discovery', () => {
  it('finds the key set from the issuer', async () => {
    const found = await discoverJwksUrl(
      TEST_ISSUER,
      fetcher({ [DISCOVERY_URL]: { jwks_uri: JWKS_URL } }),
    );
    expect(found).toBe(JWKS_URL);
  });

  it('refuses a jwks_uri pointing somewhere else entirely', async () => {
    // The discovery document is a response body from an external service, which
    // docs/14-threat-model.md §5 classes as untrusted input like any other. A
    // provider that has been tampered with must not be able to redirect key
    // fetching into the cluster.
    await expect(
      discoverJwksUrl(
        TEST_ISSUER,
        fetcher({ [DISCOVERY_URL]: { jwks_uri: 'http://169.254.169.254/latest/meta-data/' } }),
      ),
    ).rejects.toThrow(/private or loopback|not on the allow-list/);
  });

  it('refuses a jwks_uri on another host, however plausible', async () => {
    await expect(
      discoverJwksUrl(
        TEST_ISSUER,
        fetcher({ [DISCOVERY_URL]: { jwks_uri: 'https://idp.prisme.invalid.evil.test/jwks' } }),
      ),
    ).rejects.toThrow(/not on the allow-list/);
  });

  it('refuses a discovery document with no jwks_uri', async () => {
    await expect(
      discoverJwksUrl(TEST_ISSUER, fetcher({ [DISCOVERY_URL]: { issuer: TEST_ISSUER } })),
    ).rejects.toThrow(/no jwks_uri/);
  });
});

describe('the configured URL wins over anything a request could offer', () => {
  it('uses AUTH_JWKS_URL when it is set, without discovery', async () => {
    const resolved = await resolveKeySet({
      issuerUrl: TEST_ISSUER,
      jwksUrl: JWKS_URL,
      cacheTtlSeconds: 600,
      // Discovery is deliberately not routed: reaching for it would 404 here.
      fetch: fetcher({ [JWKS_URL]: keys.jwks }),
    });

    expect(resolved.url.toString()).toBe(JWKS_URL);
  });

  it('refuses a configured URL outside the issuer’s origin', async () => {
    await expect(
      resolveKeySet({
        issuerUrl: TEST_ISSUER,
        jwksUrl: 'https://somewhere.else.invalid/jwks',
        cacheTtlSeconds: 600,
        fetch: fetcher({}),
      }),
    ).rejects.toThrow(/not on the allow-list/);
  });
});

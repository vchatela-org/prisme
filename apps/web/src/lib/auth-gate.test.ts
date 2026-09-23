import type { KeySource } from '@prisme/auth';
import { createTestKeys, goodClaims, NOW, TEST_POLICY } from '@prisme/auth/test-support';
import { describe, expect, it } from 'vitest';
import { CALLBACK_PATH, gate, LOGIN_PATH, LOGOUT_PATH, type GateInput } from './auth-gate';

/**
 * The middleware's decision, without a request.
 *
 * The distinction this file exists for is ADR-0026's: a request that presents
 * **nothing** is sent to the login flow, and a request that presents something
 * **wrong** is refused. Those two are one `if` apart in the implementation and
 * worlds apart in what they mean, so each is checked from both sides.
 *
 * The tokens here are real — minted and verified by `@prisme/auth`'s own test
 * support, with a real RSA keypair generated at run time. Nothing is stubbed
 * and no key or token is committed (this repository is public, and `gitleaks`
 * runs over the whole history).
 */

const keys = await createTestKeys();

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    pathname: '/timeline',
    search: '',
    method: 'GET',
    accept: 'text/html,application/xhtml+xml',
    sessionToken: undefined,
    ...overrides,
  };
}

/** The key set the verifier is given, resolved through the injected source. */
const keySource = (): Promise<KeySource> => Promise.resolve(keys.keys);

// Nothing in this file reaches a socket or the clock: the key set is local and
// `now` is passed in, so an expiry case is an ordinary assertion rather than a
// test that sleeps.
describe('gate', () => {
  it.each([LOGIN_PATH, CALLBACK_PATH, LOGOUT_PATH])(
    'lets %s through without a session, which is how a login is ever started',
    async (pathname) => {
      await expect(gate(input({ pathname }), { policy: TEST_POLICY, keySource })).resolves.toEqual({
        kind: 'public',
      });
    },
  );

  it('sends a browser with no session to the login flow', async () => {
    await expect(gate(input(), { policy: TEST_POLICY, keySource, now: NOW })).resolves.toEqual({
      kind: 'redirect',
      location: `${LOGIN_PATH}?return_to=%2Ftimeline`,
    });
  });

  it('sends a client-side navigation the same way, because the router follows a redirect', async () => {
    // `text/x-component` is the App Router fetching a page's payload. A 401
    // there is an error boundary; a redirect is a navigation.
    await expect(
      gate(input({ accept: 'text/x-component' }), { policy: TEST_POLICY, keySource, now: NOW }),
    ).resolves.toMatchObject({ kind: 'redirect' });
  });

  it('carries the query string into return_to, encoded', async () => {
    await expect(
      gate(input({ pathname: '/backlog', search: '?area=craft&sort=score' }), {
        policy: TEST_POLICY,
        keySource,
        now: NOW,
      }),
    ).resolves.toEqual({
      kind: 'redirect',
      location: `${LOGIN_PATH}?return_to=${encodeURIComponent('/backlog?area=craft&sort=score')}`,
    });
  });

  it.each([
    ['a fetch from a page', { method: 'GET', accept: '*/*' }],
    ['a server action', { method: 'POST', accept: 'text/html' }],
    ['a DELETE', { method: 'DELETE', accept: 'text/html' }],
  ])('refuses %s with 401 rather than a redirect', async (_label, overrides) => {
    await expect(
      gate(input(overrides), { policy: TEST_POLICY, keySource, now: NOW }),
    ).resolves.toEqual({ kind: 'refused', status: 401, message: 'not authenticated' });
  });

  it('accepts a token that verifies, and hands it on unchanged', async () => {
    const token = await keys.sign(goodClaims(NOW));
    await expect(
      gate(input({ sessionToken: token }), { policy: TEST_POLICY, keySource, now: NOW }),
    ).resolves.toEqual({ kind: 'authenticated', token });
  });

  describe('a token that is presented and wrong', () => {
    // Every one of these is a *refusal*, never a redirect. Somebody probing
    // with garbage must not be handed a login flow, and a user with a corrupted
    // cookie must be told to clear it rather than bounced round a loop.
    it.each([
      ['signed by the wrong key', async () => keys.signWithWrongKey(goodClaims(NOW))],
      ['not a JWS at all', () => Promise.resolve('not-a-token')],
      [
        'expired',
        async () =>
          keys.sign({
            ...goodClaims(NOW),
            iat: Math.floor(NOW.getTime() / 1000) - 7200,
            exp: Math.floor(NOW.getTime() / 1000) - 3600,
          }),
      ],
      [
        'for a subject that is not allow-listed',
        async () => keys.sign({ ...goodClaims(NOW), sub: 'somebody-else' }),
      ],
      [
        'longer-lived than the policy allows',
        async () =>
          keys.sign({
            ...goodClaims(NOW),
            iat: Math.floor(NOW.getTime() / 1000),
            exp: Math.floor(NOW.getTime() / 1000) + 90_000,
          }),
      ],
    ])('%s is refused 401, not redirected', async (_label, mint) => {
      await expect(
        gate(input({ sessionToken: await mint() }), { policy: TEST_POLICY, keySource, now: NOW }),
      ).resolves.toEqual({ kind: 'refused', status: 401, message: 'not authenticated' });
    });

    it('tells the browser nothing about which check failed', async () => {
      const outcome = await gate(
        input({ sessionToken: await keys.signWithWrongKey(goodClaims(NOW)) }),
        {
          policy: TEST_POLICY,
          keySource,
          now: NOW,
        },
      );
      // "wrong audience" and "subject not allow-listed" are different answers,
      // and a caller who can tell them apart can map the configuration by
      // probing (docs/14-threat-model.md §5).
      expect(JSON.stringify(outcome)).not.toMatch(/signature|audience|subject|issuer|expired/i);
    });
  });

  it('answers 503 and not 401 when the key set cannot be fetched', async () => {
    // An outage is not a forged token, and a 401 would send somebody looking at
    // permissions for a problem that is not about permissions.
    const token = await keys.sign(goodClaims(NOW));
    await expect(
      gate(input({ sessionToken: token }), {
        policy: TEST_POLICY,
        keySource: () => {
          throw new Error('the key set is unreachable');
        },
        now: NOW,
      }),
    ).resolves.toEqual({
      kind: 'refused',
      status: 503,
      message: 'authentication is temporarily unavailable',
    });
  });

  it('does not verify anything for an empty cookie value', async () => {
    // A cleared cookie is a login that has not happened, not a bad token.
    await expect(
      gate(input({ sessionToken: '   ' }), { policy: TEST_POLICY, keySource, now: NOW }),
    ).resolves.toMatchObject({ kind: 'redirect' });
  });
});

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
 * An **expired** token sits on the login-flow side of that line rather than the
 * refused side, which is not obvious from the code and has its own block below:
 * it is the session ending the way its bounded lifetime says it must, and the
 * doc comment in `auth-gate.ts` files it under *no credential* in as many words.
 * The same block pins the other half — that "expired" is the **only** reason
 * that redirects, so the reason itself stays unobservable to a prober.
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

  describe('a token that is presented and expired', () => {
    // Not "wrong", and the difference is the whole of this block: expiry is the
    // session ending the way its bounded lifetime says it must, which the doc
    // comment in `auth-gate.ts` already files under *no credential* — "nobody
    // has logged in yet, **or the session has expired**". So a browser gets the
    // login flow, on the same reasoning as a request carrying no cookie at all.
    //
    // Measured on the live deployment 2026-09-25: with no cookie the app was a
    // 303 into the login flow, and with an expired cookie a 401 with no
    // redirect at all — a dead end, since the refusal is plain text with no
    // control on it and `/auth/logout` is POST-only.
    const expired = async (): Promise<string> =>
      keys.sign({
        ...goodClaims(NOW),
        iat: Math.floor(NOW.getTime() / 1000) - 7200,
        exp: Math.floor(NOW.getTime() / 1000) - 3600,
      });

    it('sends a browser to the login flow, carrying return_to', async () => {
      await expect(
        gate(input({ sessionToken: await expired() }), {
          policy: TEST_POLICY,
          keySource,
          now: NOW,
        }),
      ).resolves.toEqual({
        kind: 'redirect',
        location: `${LOGIN_PATH}?return_to=%2Ftimeline`,
      });
    });

    it('sends a client-side navigation the same way', async () => {
      await expect(
        gate(input({ sessionToken: await expired(), accept: 'text/x-component' }), {
          policy: TEST_POLICY,
          keySource,
          now: NOW,
        }),
      ).resolves.toMatchObject({ kind: 'redirect' });
    });

    it('still refuses a fetch, which is not a navigation and has no browser to redirect', async () => {
      await expect(
        gate(input({ sessionToken: await expired(), accept: '*/*' }), {
          policy: TEST_POLICY,
          keySource,
          now: NOW,
        }),
      ).resolves.toEqual({ kind: 'refused', status: 401, message: 'not authenticated' });
    });

    it('is the ONLY reason that redirects, so the reason stays unobservable', async () => {
      // Redirecting on any rejection would hand a login flow to whoever probes
      // with garbage, which is the outcome this file's doc comment refuses. Only
      // expiry — which nobody reaches without having held a real token — gets
      // the redirect, and it teaches the holder only what they already knew.
      for (const mint of [
        async () => keys.signWithWrongKey(goodClaims(NOW)),
        async () => Promise.resolve('not-a-token'),
        async () => keys.sign({ ...goodClaims(NOW), sub: 'somebody-else' }),
        async () =>
          keys.sign({
            ...goodClaims(NOW),
            iat: Math.floor(NOW.getTime() / 1000),
            exp: Math.floor(NOW.getTime() / 1000) + 90_000,
          }),
      ]) {
        await expect(
          gate(input({ sessionToken: await mint() }), { policy: TEST_POLICY, keySource, now: NOW }),
        ).resolves.toEqual({ kind: 'refused', status: 401, message: 'not authenticated' });
      }
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

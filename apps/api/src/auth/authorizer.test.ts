import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '@prisme/observability';
import type { AuthorizationRequest, AuthorizationResult } from '../http/authorize.js';
import type { Scope } from '../http/scopes.js';
import { createAuthorizer, IGNORED_IDENTITY_HEADERS } from './authorizer.js';
import { createMemoryAuthStore } from './memory-store.js';
import { originPolicyFor } from './origin.js';
import { createRateLimiter } from './rate-limit.js';
import type { AuthStore } from './store.js';
import { createTestKeys, goodClaims, NOW, TEST_POLICY, type TestKeys } from './test-support.js';
import { createTokenService, type TokenService } from './tokens.js';
import { createWriteSwitch, type WriteSwitch } from './write-switch.js';

/**
 * The authorizer, which is where ADR-0021's rules stop being a document.
 *
 * The test this file exists for is `only plaintext identity headers`. Rule 1
 * has no exception, and the way it gets broken is never a decision — it is a
 * Tuesday afternoon, a local environment with no identity provider, and a
 * five-line fallback that makes the UI work again. That test is written beside
 * the happy path so the fallback cannot be added without something going red.
 */

const logger = createLogger({ service: 'test', level: 'fatal' });
const ORIGIN = originPolicyFor('https://prisme.invalid');

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});

interface Harness {
  readonly store: AuthStore;
  readonly tokens: TokenService;
  readonly writeSwitch: WriteSwitch;
  authorize(
    request: Partial<AuthorizationRequest> & { headers?: Record<string, string> },
  ): Promise<AuthorizationResult>;
}

function harness(options: { withIdentityProvider?: boolean } = {}): Harness {
  const store = createMemoryAuthStore();
  const tokens = createTokenService({ store, pepper: 'test-pepper', now: () => NOW });
  const writeSwitch = createWriteSwitch({ store, now: () => NOW });

  const authorizer = createAuthorizer({
    assertion:
      options.withIdentityProvider === false
        ? undefined
        : { policy: TEST_POLICY, keys: keys.keys, header: 'x-prisme-assertion' },
    tokens,
    writeSwitch,
    origin: ORIGIN,
    now: () => NOW,
    logger,
    rateLimiter: createRateLimiter(),
  });

  return {
    store,
    tokens,
    writeSwitch,
    authorize(request) {
      const headers = request.headers ?? {};
      return authorizer.authorize({
        scope: request.scope ?? 'read:focus',
        method: request.method ?? 'GET',
        path: request.path ?? '/focus',
        stateChanging: request.stateChanging ?? false,
        header: (name: string) => headers[name.toLowerCase()],
      });
    },
  };
}

async function assertionHeader(claims = goodClaims()): Promise<Record<string, string>> {
  return { 'x-prisme-assertion': await keys.sign(claims) };
}

describe('which credential', () => {
  it('accepts a verified assertion', async () => {
    const result = await harness().authorize({ headers: await assertionHeader() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.kind).toBe('human');
  });

  /**
   * **The test that encodes the whole decision.**
   *
   * The gateway sets these headers on every request it forwards, and they are
   * the thing every other workload in the cluster trusts. prisme does not read
   * them: a request carrying nothing else is a request carrying no credential.
   */
  it('treats a request with only plaintext identity headers as unauthenticated', async () => {
    const headers = Object.fromEntries(
      IGNORED_IDENTITY_HEADERS.map((name) => [name, 'owner@prisme.invalid']),
    );

    const result = await harness().authorize({ headers });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(401);
  });

  it('is not persuaded by an identity header sitting beside a bad assertion', async () => {
    const result = await harness().authorize({
      headers: {
        ...Object.fromEntries(IGNORED_IDENTITY_HEADERS.map((name) => [name, 'owner'])),
        'x-prisme-assertion': await keys.signWithWrongKey(goodClaims()),
      },
    });

    expect(result.ok).toBe(false);
  });

  it('rejects an assertion presented alongside a bearer token', async () => {
    const bay = harness();
    const issued = await bay.tokens.issue({
      name: 'agent',
      scopes: ['read:focus'],
      expiresInSeconds: 3600,
      createdBy: 'sub',
    });

    // Both credentials are individually valid. ADR-0021 rule 7: this is
    // refused rather than resolved by precedence, because a precedence rule is
    // how one caller's credential silently becomes another's.
    const result = await bay.authorize({
      headers: {
        ...(await assertionHeader()),
        authorization: `Bearer ${issued.token}`,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(401);
  });

  it('answers the same 401 whatever went wrong', async () => {
    const bay = harness();
    const messages = new Set<string>();

    for (const claims of [
      { ...goodClaims(), aud: 'someone-else' },
      { ...goodClaims(), sub: 'not-allow-listed' },
      { ...goodClaims(), iss: 'https://evil.invalid' },
    ]) {
      const result = await bay.authorize({
        headers: { 'x-prisme-assertion': await keys.sign(claims) },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) messages.add(result.error.message);
    }
    const nothing = await bay.authorize({ headers: {} });
    if (!nothing.ok) messages.add(nothing.error.message);

    // One sentence, four causes. A caller that could tell them apart could map
    // the configuration by probing (docs/14-threat-model.md §5).
    expect(messages.size).toBe(1);
  });

  it('still authenticates agents when no identity provider is configured', async () => {
    const bay = harness({ withIdentityProvider: false });
    const issued = await bay.tokens.issue({
      name: 'agent',
      scopes: ['read:focus'],
      expiresInSeconds: 3600,
      createdBy: 'sub',
    });

    await expect(
      bay.authorize({ headers: { authorization: `Bearer ${issued.token}` } }),
    ).resolves.toMatchObject({ ok: true });
    // …and the human path is simply closed, rather than opened.
    await expect(
      bay.authorize({ headers: { 'x-prisme-assertion': await keys.sign(goodClaims()) } }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe('a read-scoped token', () => {
  let bay: Harness;
  let token: string;

  beforeEach(async () => {
    bay = harness();
    const issued = await bay.tokens.issue({
      name: 'reader',
      scopes: ['read:focus', 'read:backlog'],
      expiresInSeconds: 3600,
      createdBy: 'sub',
    });
    token = issued.token;
  });

  it('authenticates, and carries exactly the scopes it was granted', async () => {
    const result = await bay.authorize({ headers: { authorization: `Bearer ${token}` } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.kind).toBe('agent');
      expect([...result.identity.scopes].sort()).toEqual(['read:backlog', 'read:focus']);
    }
  });

  /**
   * The definition-of-done item, asserted at the mechanism rather than at one
   * endpoint: the identity a write route would be checked against does not hold
   * a single write scope, so there is no write endpoint it can reach.
   */
  it('cannot reach any write endpoint, because it holds no write scope', async () => {
    const result = await bay.authorize({
      scope: 'write:initiative',
      method: 'POST',
      stateChanging: true,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.scopes.some((scope: Scope) => scope.startsWith('write:'))).toBe(false);
      // `mountRoutes` refuses it from here — the same `holdsScope` check every
      // route goes through, with no special case for a token.
      expect(result.identity.scopes).not.toContain('write:initiative');
    }
  });

  it('stops working the moment it is revoked', async () => {
    const before = await bay.authorize({ headers: { authorization: `Bearer ${token}` } });
    expect(before.ok).toBe(true);

    const id = (await bay.tokens.list())[0]?.id as string;
    await bay.tokens.revoke(id);

    // Immediately, not after a cache window: only the Argon2 comparison is
    // cached, and revocation is read from the store on every request.
    const after = await bay.authorize({ headers: { authorization: `Bearer ${token}` } });
    expect(after.ok).toBe(false);
  });
});

describe('cross-site state-changing requests', () => {
  it('refuses a state-changing assertion request with no Origin', async () => {
    const result = await harness().authorize({
      method: 'POST',
      scope: 'write:initiative',
      stateChanging: true,
      headers: await assertionHeader(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(403);
  });

  it('refuses one from another origin', async () => {
    const result = await harness().authorize({
      method: 'POST',
      scope: 'write:initiative',
      stateChanging: true,
      headers: { ...(await assertionHeader()), origin: 'https://evil.invalid' },
    });

    expect(result.ok).toBe(false);
  });

  it('allows one from prisme itself', async () => {
    const result = await harness().authorize({
      method: 'POST',
      scope: 'write:initiative',
      stateChanging: true,
      headers: { ...(await assertionHeader()), origin: 'https://prisme.invalid' },
    });

    expect(result.ok).toBe(true);
  });

  it('does not impose an Origin on the bearer path', async () => {
    const bay = harness();
    const issued = await bay.tokens.issue({
      name: 'agent',
      scopes: ['write:initiative'],
      expiresInSeconds: 3600,
      createdBy: 'sub',
    });

    // A script has no origin, and no ambient credential either — CSRF does not
    // apply to it, so requiring one would cost usability for no security.
    await expect(
      bay.authorize({
        method: 'POST',
        scope: 'write:initiative',
        stateChanging: true,
        headers: { authorization: `Bearer ${issued.token}` },
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe('the kill switch', () => {
  it('withholds write:sync in outward mode, and leaves reads alone', async () => {
    const bay = harness();
    await bay.writeSwitch.engage({
      mode: 'outward',
      by: 'owner',
      reason: 'reconciler misbehaving',
    });

    const write = await bay.authorize({
      scope: 'write:sync',
      method: 'POST',
      stateChanging: true,
      headers: { ...(await assertionHeader()), origin: 'https://prisme.invalid' },
    });
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error.status).toBe(423);

    const read = await bay.authorize({ scope: 'read:focus', headers: await assertionHeader() });
    expect(read.ok).toBe(true);
  });

  it('withholds every write scope in all mode, and still not admin or read', async () => {
    const bay = harness();
    await bay.writeSwitch.engage({ mode: 'all', by: 'owner', reason: 'something is wrong' });

    const result = await bay.authorize({ scope: 'read:focus', headers: await assertionHeader() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.scopes.some((scope: Scope) => scope.startsWith('write:'))).toBe(false);
      // `admin:settings` survives, or releasing the switch would need a
      // database session.
      expect(result.identity.scopes).toContain('admin:settings');
      expect(result.identity.scopes).toContain('read:focus');
    }
  });

  it('is released back to what the deployment already allowed', async () => {
    const bay = harness();
    await bay.writeSwitch.engage({ mode: 'all', by: 'owner', reason: 'testing' });
    await bay.writeSwitch.release('owner');

    const result = await bay.authorize({
      scope: 'write:initiative',
      method: 'POST',
      stateChanging: true,
      headers: { ...(await assertionHeader()), origin: 'https://prisme.invalid' },
    });
    expect(result.ok).toBe(true);
  });
});

describe('rate limiting', () => {
  it('throttles one credential without touching another', async () => {
    const bay = harness();
    const noisy = await bay.tokens.issue({
      name: 'noisy',
      scopes: ['write:initiative'],
      expiresInSeconds: 3600,
      createdBy: 'sub',
    });
    const quiet = await bay.tokens.issue({
      name: 'quiet',
      scopes: ['write:initiative'],
      expiresInSeconds: 3600,
      createdBy: 'sub',
    });

    const write = (token: string) =>
      bay.authorize({
        scope: 'write:initiative',
        method: 'POST',
        stateChanging: true,
        headers: { authorization: `Bearer ${token}` },
      });

    let limited: AuthorizationResult | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await write(noisy.token);
      if (!result.ok) {
        limited = result;
        break;
      }
    }

    expect(limited, 'a runaway agent was never throttled').toBeDefined();
    if (limited !== undefined && !limited.ok) {
      expect(limited.error.status).toBe(429);
      expect(limited.error.headers?.['retry-after']).toMatch(/^\d+$/);
    }

    // Keyed on the credential, so the other agent is unaffected.
    await expect(write(quiet.token)).resolves.toMatchObject({ ok: true });
  });
});

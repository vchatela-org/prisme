import { describe, expect, it } from 'vitest';
import { createMemoryAuthStore } from './memory-store.js';
import { MAX_TOKEN_LIFETIME_SECONDS, TokenRejection, createTokenService } from './tokens.js';
import { TOKEN_PREFIX, looksLikeApiToken, parseToken } from './token-format.js';

/**
 * The token half of ADR-0015, against the rules in
 * docs/14-threat-model.md §3 — one test per rule, so a rule that stops holding
 * has a name rather than a gap.
 */

const PEPPER = 'a-test-pepper';

function service(now: Date = new Date('2026-09-18T10:00:00.000Z')) {
  const store = createMemoryAuthStore();
  let clock = now;
  return {
    store,
    advance: (seconds: number) => {
      clock = new Date(clock.getTime() + seconds * 1000);
    },
    tokens: createTokenService({ store, pepper: PEPPER, now: () => clock }),
  };
}

describe('the wire format', () => {
  it('carries a recognisable prefix, so a scanner can find a leak', async () => {
    const { tokens } = service();
    const issued = await tokens.issue({
      name: 'agent',
      scopes: ['read:focus'],
      expiresInSeconds: 3600,
      createdBy: 'owner',
    });

    expect(issued.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(looksLikeApiToken(issued.token)).toBe(true);
  });

  it('splits into a public id and a secret half', async () => {
    const { tokens } = service();
    const issued = await tokens.issue({
      name: 'agent',
      scopes: ['read:focus'],
      expiresInSeconds: 3600,
      createdBy: 'owner',
    });

    const parsed = parseToken(issued.token);
    expect(parsed?.id).toBe(issued.record.id);
    expect(parsed?.secret).toHaveLength(43);
  });

  it('refuses a malformed credential without touching the store', () => {
    for (const bad of ['', 'nope', `${TOKEN_PREFIX}short.secret`, 'Bearer something']) {
      expect(parseToken(bad)).toBeUndefined();
    }
  });
});

describe('at rest', () => {
  it('stores an Argon2id hash and never the plaintext', async () => {
    const { store, tokens } = service();
    const issued = await tokens.issue({
      name: 'agent',
      scopes: ['read:focus'],
      expiresInSeconds: 3600,
      createdBy: 'owner',
    });

    const stored = await store.findToken(issued.record.id);
    expect(stored?.hash.startsWith('$argon2id$')).toBe(true);
    // Neither half of the credential is recoverable from what was written.
    expect(stored?.hash).not.toContain(issued.token);
    expect(JSON.stringify(stored)).not.toContain(parseToken(issued.token)?.secret);
  });

  it('is not verifiable without the pepper', async () => {
    const { store, tokens } = service();
    const issued = await tokens.issue({
      name: 'agent',
      scopes: ['read:focus'],
      expiresInSeconds: 3600,
      createdBy: 'owner',
    });

    // A database dump alone is not a set of credentials: the pepper is not in
    // the database (docs/14-threat-model.md §3).
    const impostor = createTokenService({
      store,
      pepper: 'the-wrong-pepper',
      now: () => new Date('2026-09-18T10:00:00.000Z'),
    });
    await expect(impostor.verify(issued.token)).rejects.toMatchObject({ reason: 'secret' });
  });

  it('never returns the plaintext again', async () => {
    const { tokens } = service();
    await tokens.issue({
      name: 'agent',
      scopes: ['read:focus'],
      expiresInSeconds: 3600,
      createdBy: 'owner',
    });

    const listed = await tokens.list();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(TOKEN_PREFIX);
    // Not even the hash leaves the store through the management surface.
    expect(listed[0]).not.toHaveProperty('hash');
  });
});

describe('scopes, expiry and revocation', () => {
  it('refuses to mint a token with no scope', async () => {
    const { tokens } = service();
    await expect(
      tokens.issue({ name: 'useless', scopes: [], expiresInSeconds: 3600, createdBy: 'owner' }),
    ).rejects.toBeInstanceOf(TokenRejection);
  });

  it('clamps a lifetime rather than honouring it', async () => {
    const { tokens } = service();
    const issued = await tokens.issue({
      name: 'forever',
      scopes: ['read:focus'],
      expiresInSeconds: MAX_TOKEN_LIFETIME_SECONDS * 10,
      createdBy: 'owner',
    });

    const life = (issued.record.expiresAt.getTime() - issued.record.createdAt.getTime()) / 1000;
    expect(life).toBe(MAX_TOKEN_LIFETIME_SECONDS);
  });

  it('stops accepting an expired token', async () => {
    const bay = service();
    const issued = await bay.tokens.issue({
      name: 'short',
      scopes: ['read:focus'],
      expiresInSeconds: 60,
      createdBy: 'owner',
    });

    await expect(bay.tokens.verify(issued.token)).resolves.toMatchObject({ kind: 'agent' });
    bay.advance(61);
    await expect(bay.tokens.verify(issued.token)).rejects.toMatchObject({ reason: 'expired' });
  });

  it('revokes in bulk', async () => {
    const { tokens } = service();
    for (const name of ['a', 'b', 'c']) {
      await tokens.issue({
        name,
        scopes: ['read:focus'],
        expiresInSeconds: 3600,
        createdBy: 'owner',
      });
    }

    expect(await tokens.revokeAll()).toBe(3);
    // Idempotent: a second sweep finds nothing live, rather than reporting three again.
    expect(await tokens.revokeAll()).toBe(0);
  });

  it('records last_used_at, which is what makes a stale token visible', async () => {
    const bay = service();
    const issued = await bay.tokens.issue({
      name: 'agent',
      scopes: ['read:focus'],
      expiresInSeconds: 3600,
      createdBy: 'owner',
    });

    expect(issued.record.lastUsedAt).toBeNull();
    await bay.tokens.verify(issued.token);
    // Written off the request path, so give the microtask queue a turn.
    await Promise.resolve();
    expect((await bay.tokens.list())[0]?.lastUsedAt).not.toBeNull();
  });
});

describe('the verification cache', () => {
  it('does not let a cached match outlive a revocation', async () => {
    const bay = service();
    const issued = await bay.tokens.issue({
      name: 'agent',
      scopes: ['read:focus'],
      expiresInSeconds: 3600,
      createdBy: 'owner',
    });

    await bay.tokens.verify(issued.token); // populates the cache
    await bay.tokens.revoke(issued.record.id);

    // The cache holds only "this string matches that hash", which stays true.
    // Everything that can change is read live.
    await expect(bay.tokens.verify(issued.token)).rejects.toMatchObject({ reason: 'revoked' });
  });

  it('does not let one token’s cached result open another', async () => {
    const bay = service();
    const first = await bay.tokens.issue({
      name: 'first',
      scopes: ['read:focus'],
      expiresInSeconds: 3600,
      createdBy: 'owner',
    });
    await bay.tokens.verify(first.token);

    // The id of one token with the secret of nothing in particular.
    const forged = `${TOKEN_PREFIX}${first.record.id}.${'A'.repeat(43)}`;
    await expect(bay.tokens.verify(forged)).rejects.toMatchObject({ reason: 'secret' });
  });
});

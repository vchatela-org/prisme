import { beforeAll, describe, expect, it } from 'vitest';
import { AssertionRejection, assertPolicyUsable, verifyAssertion } from './assertion.js';
import {
  createTestKeys,
  goodClaims,
  NOW,
  TEST_POLICY,
  TEST_SUBJECT,
  type TestKeys,
} from './test-support.js';

/**
 * The rejection table from W14's definition of done, one test per row.
 *
 * The brief lists nine cases and asks for each to be "proven by its own test",
 * and that phrasing is doing work: a single test that loops over bad tokens
 * passes when eight of nine are rejected for the wrong reason. Each case here
 * asserts the *reason* as well as the refusal, so a check that starts firing
 * early — an expired token rejected for its algorithm, say — is a failure
 * rather than a pass.
 *
 * The ninth case, an assertion presented alongside a bearer token, is not a
 * property of the verifier: it is decided before either credential is looked
 * at. It lives in `authorizer.test.ts`.
 */

let keys: TestKeys;
beforeAll(async () => {
  keys = await createTestKeys();
});

async function rejection(jwt: string, at: Date = NOW): Promise<AssertionRejection> {
  try {
    await verifyAssertion(jwt, at, { policy: TEST_POLICY, keys: keys.keys });
  } catch (error) {
    if (error instanceof AssertionRejection) return error;
    throw error;
  }
  throw new Error('the assertion was accepted, and this test exists because it must not be');
}

describe('a well-formed assertion', () => {
  it('resolves to a verified subject, keyed on sub', async () => {
    const verified = await verifyAssertion(await keys.sign(goodClaims()), NOW, {
      policy: TEST_POLICY,
      keys: keys.keys,
    });

    expect(verified.subject).toBe(TEST_SUBJECT);
    // Display material, and provably not the identity: the subject above is the
    // opaque `sub`, not the username or the address.
    expect(verified.display.username).toBe('owner');
    expect(verified.display.email).toBe('owner@prisme.invalid');
    expect(verified.subject).not.toBe(verified.display.email);
  });

  it('says nothing about what the subject may do', async () => {
    const verified = await verifyAssertion(await keys.sign(goodClaims()), NOW, {
      policy: TEST_POLICY,
      keys: keys.keys,
    });

    // Authorization is prisme's domain and lives in apps/api
    // (docs/14-threat-model.md §3). A verifier that also handed out permissions
    // would be a second place for that decision to live.
    expect(verified).not.toHaveProperty('scopes');
    expect(Object.keys(verified).sort()).toEqual(['display', 'subject']);
  });

  it('tolerates a clock a little behind the provider', async () => {
    const claims = goodClaims();
    // Issued 30 seconds in this instance's future, inside the 60s skew.
    const ahead = new Date(NOW.getTime() - 30_000);
    await expect(
      verifyAssertion(await keys.sign(claims), ahead, { policy: TEST_POLICY, keys: keys.keys }),
    ).resolves.toMatchObject({ subject: TEST_SUBJECT });
  });
});

describe('the nine refusals', () => {
  it('rejects a token signed by the wrong key', async () => {
    const error = await rejection(await keys.signWithWrongKey(goodClaims()));
    expect(error.reason).toBe('signature');
  });

  it('rejects alg: none', async () => {
    // An unsecured JWT — the header says `none` and there is no signature at
    // all. It must not get as far as asking for a key.
    const error = await rejection(keys.unsecured(goodClaims()));
    expect(error.reason).toBe('algorithm');
  });

  it('rejects an HMAC alg, which is what a provider with no keypair produces', async () => {
    const error = await rejection(await keys.signHmac(goodClaims()));
    expect(error.reason).toBe('algorithm');
  });

  it('rejects an asymmetric alg the policy does not list', async () => {
    // Genuinely PS256-signed against a key that is genuinely in the key set.
    // Only the policy's list refuses it — which is the point: `allowedAlgs`
    // narrows, and narrowing has to be real rather than incidental.
    const error = await rejection(await keys.signPs256(goodClaims()));
    expect(error.reason).toBe('algorithm');
  });

  it('rejects a wrong iss', async () => {
    const error = await rejection(
      await keys.sign({ ...goodClaims(), iss: 'https://evil.invalid/o/prisme' }),
    );
    expect(error.reason).toBe('issuer');
  });

  it('rejects a wrong aud', async () => {
    const error = await rejection(await keys.sign({ ...goodClaims(), aud: 'some-other-client' }));
    expect(error.reason).toBe('audience');
  });

  it('rejects a missing aud', async () => {
    const { aud: _aud, ...claims } = goodClaims();
    const error = await rejection(await keys.sign(claims));
    expect(error.reason).toBe('audience');
  });

  it('rejects an expired one, past the skew', async () => {
    const claims = goodClaims();
    const wellPast = new Date(NOW.getTime() + 900_000 + 61_000);
    const error = await rejection(await keys.sign(claims), wellPast);
    expect(error.reason).toBe('expired');
  });

  it('rejects one that is not valid yet', async () => {
    const claims = { ...goodClaims(), nbf: Math.floor(NOW.getTime() / 1000) + 600 };
    const error = await rejection(await keys.sign(claims));
    expect(error.reason).toBe('not_yet_valid');
  });

  it('rejects one whose exp - iat exceeds the maximum lifetime', async () => {
    const issued = Math.floor(NOW.getTime() / 1000);
    // A year. Signed correctly, unexpired, right issuer and audience — every
    // check but this one passes, which is exactly why rule 3 exists: a provider
    // misconfigured to issue long-lived tokens is a mistake prisme can detect
    // rather than inherit.
    const claims = { ...goodClaims(), iat: issued, exp: issued + 365 * 24 * 3600 };
    const error = await rejection(await keys.sign(claims));
    expect(error.reason).toBe('lifetime');
  });

  it('rejects one with no iat, because its lifetime cannot be bounded', async () => {
    const { iat: _iat, ...claims } = goodClaims();
    const error = await rejection(await keys.sign(claims));
    expect(error.reason).toBe('claims');
  });

  it('rejects a sub outside the allow-list', async () => {
    const error = await rejection(await keys.sign({ ...goodClaims(), sub: 'someone-else' }));
    expect(error.reason).toBe('subject');
  });

  it('rejects something that is not a JWT at all', async () => {
    const error = await rejection('not-a-token');
    expect(error.reason).toBe('malformed');
  });
});

describe('a refusal echoes nothing it was given', () => {
  /*
   * These messages are internal: `authorizer.ts` turns every one of them into
   * the same `401` with one sentence, and `authorizer.test.ts` is where that
   * indistinguishability is asserted. What has to be true *here* is narrower and
   * still worth pinning — a rejection message is written to the log, and it must
   * not carry the attacker-supplied value that caused it.
   */
  it('names the claim that was wrong, never its value', async () => {
    const wrongAudience = await rejection(
      await keys.sign({ ...goodClaims(), aud: 'some-other-client' }),
    );
    const wrongSubject = await rejection(await keys.sign({ ...goodClaims(), sub: 'someone-else' }));
    const wrongIssuer = await rejection(
      await keys.sign({ ...goodClaims(), iss: 'https://evil.invalid/o/prisme' }),
    );

    expect(wrongAudience.message).not.toContain('some-other-client');
    expect(wrongSubject.message).not.toContain('someone-else');
    expect(wrongIssuer.message).not.toContain('evil.invalid');
    // Nor the configured values, which are what a probe is trying to learn.
    expect(wrongSubject.message).not.toContain(TEST_SUBJECT);
  });
});

describe('a policy that could never authenticate anybody', () => {
  it('refuses an empty subject allow-list rather than reading it as "everyone"', () => {
    expect(() => {
      assertPolicyUsable({ ...TEST_POLICY, allowedSubjects: [] });
    }).toThrow(/AUTH_ALLOWED_SUBJECTS is empty/);
  });

  it('refuses an algorithm list with nothing asymmetric left', () => {
    expect(() => {
      assertPolicyUsable({ ...TEST_POLICY, allowedAlgs: ['HS256'] });
    }).toThrow(/no asymmetric algorithm/);
  });

  it('narrows the configured list rather than trusting it', async () => {
    // A deployment may narrow the set; nothing can widen it past asymmetric.
    const narrowed = { ...TEST_POLICY, allowedAlgs: ['ES256'] };
    await expect(
      verifyAssertion(await keys.sign(goodClaims()), NOW, {
        policy: narrowed,
        keys: keys.keys,
      }),
    ).rejects.toMatchObject({ reason: 'algorithm' });
  });
});

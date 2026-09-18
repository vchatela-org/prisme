import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  generateSecret,
  SignJWT,
  UnsecuredJWT,
  type CryptoKey,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose';
import type { AssertionPolicy } from './assertion.js';

/**
 * Keys and tokens for the verifier's tests.
 *
 * Everything here is generated at run time. Nothing in this directory ever
 * commits a token, a key or a credential-shaped literal — `gitleaks` runs over
 * the entire history on every pull request, secret-scanning push protection is
 * on, and a fixture that trips either of them costs a history rewrite to
 * remove. Generating is also simply more honest: a real signature is being
 * verified rather than a string that was pasted in once and has meant nothing
 * since.
 */

export const TEST_ISSUER = 'https://idp.prisme.invalid/application/o/prisme';
export const TEST_AUDIENCE = 'prisme-client-id';
export const TEST_SUBJECT = 'a1b2c3d4e5f6';

export const TEST_POLICY: AssertionPolicy = {
  issuer: TEST_ISSUER,
  audience: TEST_AUDIENCE,
  allowedAlgs: ['RS256', 'ES256'],
  allowedSubjects: [TEST_SUBJECT],
  clockSkewSeconds: 60,
  maxLifetimeSeconds: 3600,
};

export const NOW = new Date('2026-09-18T10:00:00.000Z');

function seconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

export interface TestKeys {
  /** What the verifier is given. Backed by the public half only, as in production. */
  readonly keys: JWTVerifyGetKey;
  readonly jwks: { keys: JWK[] };
  /** A second, unrelated keypair — the "signed by the wrong key" case. */
  sign(claims: Record<string, unknown>, options?: SignOptions): Promise<string>;
  signWithWrongKey(claims: Record<string, unknown>): Promise<string>;
  signHmac(claims: Record<string, unknown>): Promise<string>;
  /**
   * A genuinely PS256-signed token, for "asymmetric but not on the policy's
   * list". It needs its own keypair: a WebCrypto RSASSA-PKCS1-v1_5 key cannot
   * produce an RSA-PSS signature, so reusing the RS256 key throws in the
   * *signer* and proves nothing about the verifier.
   */
  signPs256(claims: Record<string, unknown>): Promise<string>;
  unsecured(claims: Record<string, unknown>): string;
}

export interface SignOptions {
  readonly alg?: string;
  readonly kid?: string | undefined;
}

/**
 * Claims for a request that should succeed, so every failing case can be
 * expressed as one field changed.
 */
export function goodClaims(at: Date = NOW): Record<string, unknown> {
  return {
    iss: TEST_ISSUER,
    aud: TEST_AUDIENCE,
    sub: TEST_SUBJECT,
    iat: seconds(at),
    exp: seconds(at) + 900,
    preferred_username: 'owner',
    email: 'owner@prisme.invalid',
  };
}

export async function createTestKeys(): Promise<TestKeys> {
  const real = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  const pss = await generateKeyPair('PS256', { extractable: true });
  const publicJwk = { ...(await exportJWK(real.publicKey)), kid: 'test-key', alg: 'RS256' };
  const pssJwk = { ...(await exportJWK(pss.publicKey)), kid: 'pss-key', alg: 'PS256' };
  const jwks = { keys: [publicJwk, pssJwk] };
  const keys = createLocalJWKSet(jwks);

  async function signWith(
    key: CryptoKey,
    claims: Record<string, unknown>,
    options: SignOptions = {},
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'test-key' })
      .sign(key);
  }

  return {
    keys,
    jwks,
    sign: (claims, options) => signWith(real.privateKey, claims, options),
    signWithWrongKey: (claims) => signWith(other.privateKey, claims),
    signPs256: (claims) => signWith(pss.privateKey, claims, { alg: 'PS256', kid: 'pss-key' }),
    async signHmac(claims) {
      // The alg-confusion case, and the one a misconfigured provider actually
      // produces: an identity provider with no signing keypair falls back to
      // HMAC with the client secret (ADR-0021 context).
      const secret = await generateSecret('HS256');
      return new SignJWT(claims).setProtectedHeader({ alg: 'HS256', kid: 'test-key' }).sign(secret);
    },
    unsecured: (claims) => new UnsecuredJWT(claims).encode(),
  };
}

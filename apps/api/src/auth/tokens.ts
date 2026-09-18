import { hash as argon2Hash, verify as argon2Verify, type Algorithm } from '@node-rs/argon2';
import type { Scope } from '../http/scopes.js';
import { isScope } from '../http/scopes.js';
import type { Principal } from './principal.js';
import type { ApiTokenRecord, AuthStore } from './store.js';
import { fingerprint, mintTokenMaterial, parseToken, type MintedToken } from './token-format.js';

/**
 * Scoped API tokens for machines — docs/14-threat-model.md §3, ADR-0015.
 *
 * Agents cannot complete an interactive login, so they need a bearer credential
 * whatever else is true. Every rule in the threat model's token list is here:
 * Argon2id at rest, plaintext shown exactly once, scoped with no wildcard,
 * expiring, revocable individually and in bulk, `last_used_at` recorded.
 *
 * ### Argon2id, and the cost it puts on every request
 *
 * A password hash is slow on purpose, and a bearer token is presented on
 * *every* request rather than once a session. Verifying at ~50ms per request
 * would make the deliberate slowness an availability problem, and the usual
 * escape — hashing tokens with SHA-256 because "they are high-entropy anyway" —
 * is how a leaked database dump becomes a leaked set of credentials.
 *
 * So the hash stays Argon2id and the *repetition* is what is removed: a short
 * in-memory cache of verification outcomes, keyed by a SHA-256 fingerprint of
 * the presented credential.
 *
 * What the cache holds is only "this exact string did or did not match this
 * row's hash" — a fact that cannot change, because a token's secret is never
 * updated. **Revocation, expiry and scopes are read from the database on every
 * single request regardless**, so a revoked token stops working immediately
 * rather than at the end of a cache window. That split is the whole design: the
 * expensive answer is the immutable one, the mutable answers stay live.
 *
 * Negative results are cached too, and for the same duration. Without that, an
 * attacker replaying one wrong guess is a way to hold the process in Argon2.
 */

/**
 * OWASP's second recommended configuration, which is also this binding's
 * default. Stated anyway: a security parameter that is correct because a
 * dependency's default happens to be correct is one that changes in a patch
 * release.
 *
 * `Algorithm.Argon2id` is written as its value because the binding declares
 * `Algorithm` as an ambient `const enum`, which `verbatimModuleSyntax` cannot
 * import — the `satisfies` keeps the number honest against the enum's type, and
 * `api_token.hash` carries a `LIKE '$argon2id$%'` check so a wrong value here
 * fails at the database rather than silently weakening every stored credential.
 */
const ARGON2 = {
  algorithm: 2 satisfies Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const VERIFICATION_CACHE_TTL_MS = 60_000;
const VERIFICATION_CACHE_MAX = 1_000;

export interface TokenServiceOptions {
  readonly store: AuthStore;
  /** `TOKEN_PEPPER`. Mixed into every hash, so a database dump alone is not enough. */
  readonly pepper: string;
  readonly now: () => Date;
  /** Injected in tests to make minting deterministic. */
  readonly random?: ((size: number) => Buffer) | undefined;
}

export interface IssueTokenInput {
  readonly name: string;
  readonly scopes: readonly Scope[];
  /** Seconds. Bounded by {@link MAX_TOKEN_LIFETIME_SECONDS}. */
  readonly expiresInSeconds: number;
  /** The `sub` of the human minting it. */
  readonly createdBy: string;
}

export interface IssuedToken {
  readonly record: ApiTokenRecord;
  /** Displayed exactly once. Not stored, not logged, not returned again. */
  readonly token: string;
}

/**
 * A year, and it is a ceiling rather than a default.
 *
 * "Expiring by default" is only a control if the default cannot be written as
 * `never`. The API has no way to express an unexpiring token: the field is
 * required and it is clamped here.
 */
export const MAX_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
export const DEFAULT_TOKEN_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

export type TokenRejectionReason =
  'malformed' | 'unknown' | 'secret' | 'revoked' | 'expired' | 'scopes';

export class TokenRejection extends Error {
  readonly reason: TokenRejectionReason;

  constructor(reason: TokenRejectionReason, message: string) {
    super(message);
    this.name = 'TokenRejection';
    this.reason = reason;
  }
}

interface CacheEntry {
  readonly matched: boolean;
  readonly tokenId: string;
  readonly at: number;
}

export interface TokenService {
  issue(input: IssueTokenInput): Promise<IssuedToken>;
  list(): Promise<readonly ApiTokenRecord[]>;
  revoke(id: string): Promise<boolean>;
  revokeAll(): Promise<number>;
  /** Throws {@link TokenRejection}. Never returns a fallback principal. */
  verify(presented: string): Promise<Principal>;
}

export function createTokenService(options: TokenServiceOptions): TokenService {
  const pepper = Buffer.from(options.pepper, 'utf8');
  const cache = new Map<string, CacheEntry>();

  function cached(key: string, nowMs: number): CacheEntry | undefined {
    const entry = cache.get(key);
    if (entry === undefined) return undefined;
    if (nowMs - entry.at > VERIFICATION_CACHE_TTL_MS) {
      cache.delete(key);
      return undefined;
    }
    return entry;
  }

  function remember(key: string, entry: CacheEntry): void {
    // A plain size cap with oldest-first eviction. Insertion order is Map's
    // iteration order, and a cache that can grow without bound on presented
    // credentials is a memory pedal wired to an unauthenticated caller.
    if (cache.size >= VERIFICATION_CACHE_MAX) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, entry);
  }

  return {
    async issue(input: IssueTokenInput): Promise<IssuedToken> {
      if (input.scopes.length === 0) {
        throw new TokenRejection(
          'scopes',
          'a token with no scope can do nothing; name at least one',
        );
      }
      for (const scope of input.scopes) {
        // Belt and braces with the Zod schema on the route: a scope that is not
        // in the vocabulary would be stored, granted and forever unmatched.
        if (!isScope(scope))
          throw new TokenRejection('scopes', `${String(scope)} is not a known scope`);
      }

      const lifetime = Math.min(input.expiresInSeconds, MAX_TOKEN_LIFETIME_SECONDS);
      const now = options.now();
      const material: MintedToken = mintTokenMaterial(options.random);

      const record = await options.store.createToken({
        id: material.id,
        name: input.name,
        scopes: input.scopes,
        hash: await argon2Hash(material.secret, { ...ARGON2, secret: pepper }),
        createdAt: now,
        createdBy: input.createdBy,
        expiresAt: new Date(now.getTime() + lifetime * 1000),
      });

      return { record, token: material.token };
    },

    list: () => options.store.listTokens(),
    revoke: (id: string) => options.store.revokeToken(id, options.now()),
    revokeAll: () => options.store.revokeAllTokens(options.now()),

    async verify(presented: string): Promise<Principal> {
      const parsed = parseToken(presented);
      if (parsed === undefined) throw new TokenRejection('malformed', 'not a prisme API token');

      const record = await options.store.findToken(parsed.id);
      if (record === undefined) throw new TokenRejection('unknown', 'no such token');

      const now = options.now();
      const key = fingerprint(presented);
      const hit = cached(key, now.getTime());

      let matched: boolean;
      if (hit !== undefined && hit.tokenId === record.id) {
        matched = hit.matched;
      } else {
        matched = await argon2Verify(record.hash, parsed.secret, { secret: pepper });
        remember(key, { matched, tokenId: record.id, at: now.getTime() });
      }
      if (!matched) throw new TokenRejection('secret', 'the token secret does not match');

      // Read live, every request, after the cache: see the note at the top.
      if (record.revokedAt !== null) throw new TokenRejection('revoked', 'the token was revoked');
      if (record.expiresAt.getTime() <= now.getTime()) {
        throw new TokenRejection('expired', 'the token has expired');
      }

      // Not awaited: a failure to record use must not refuse a valid request.
      void options.store.touchToken(record.id, now).catch(() => undefined);

      return {
        kind: 'agent',
        subject: `token:${record.id}`,
        scopes: record.scopes,
        tokenId: record.id,
      };
    },
  };
}

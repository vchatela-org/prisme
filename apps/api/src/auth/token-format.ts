import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * The wire format of a prisme API token.
 *
 *     prisme_pat_<id>.<secret>
 *     └────┬────┘ └┬┘  └──┬───┘
 *          │       │      └ 256 bits of randomness. Argon2id-hashed at rest;
 *          │       │        prisme never stores or logs this part
 *          │       └ 96 bits, stored in clear. The lookup key
 *          └ a fixed prefix, so a secret scanner can recognise a leak
 *
 * ### Why the identifier is in the token
 *
 * Without it, authenticating a request means Argon2-verifying the presented
 * secret against *every* stored hash until one matches — a cost that is linear
 * in the number of tokens and that a caller can trigger at will, which is a
 * denial-of-service pedal wired directly to a deliberately slow function. With
 * it, one indexed lookup finds one row and one hash is verified.
 *
 * The identifier is not secret and carries no authority on its own: it names a
 * row, and the row only opens for the 256-bit half.
 *
 * ### Why the prefix matters
 *
 * docs/14-threat-model.md §3 asks for "a recognisable prefix so secret scanners
 * can detect a leak". `prisme_pat_` is that. It is also why the tests in this
 * directory mint their tokens at runtime rather than hard-coding a sample: a
 * literal in a committed file is exactly the string the prefix is designed to
 * make findable, and `gitleaks` runs over the whole history on every pull
 * request.
 */

export const TOKEN_PREFIX = 'prisme_pat_';

/** 12 bytes → 16 base64url characters. */
const ID_BYTES = 12;
/** 32 bytes → 43 base64url characters. Nothing here is guessable at that size. */
const SECRET_BYTES = 32;

export interface MintedToken {
  /** Shown to the operator exactly once, at creation, and never stored. */
  readonly token: string;
  readonly id: string;
  readonly secret: string;
}

export function mintTokenMaterial(random: (size: number) => Buffer = randomBytes): MintedToken {
  const id = random(ID_BYTES).toString('base64url');
  const secret = random(SECRET_BYTES).toString('base64url');
  return { token: `${TOKEN_PREFIX}${id}.${secret}`, id, secret };
}

export interface ParsedToken {
  readonly id: string;
  readonly secret: string;
}

const SHAPE = new RegExp(`^${TOKEN_PREFIX}([A-Za-z0-9_-]{16})\\.([A-Za-z0-9_-]{43})$`);

/**
 * Split a presented token, or return `undefined`.
 *
 * Shape is checked before the database is touched. A malformed credential
 * should cost one regular expression, not a query — and certainly not an
 * Argon2 verification.
 */
export function parseToken(presented: string): ParsedToken | undefined {
  const match = SHAPE.exec(presented.trim());
  if (!match) return undefined;
  return { id: match[1] as string, secret: match[2] as string };
}

/** True when a string looks like one of prisme's tokens, whatever its contents. */
export function looksLikeApiToken(value: string): boolean {
  return value.trim().startsWith(TOKEN_PREFIX);
}

/**
 * The cache key for a presented token.
 *
 * SHA-256 of the whole credential, so the verification cache in `tokens.ts` can
 * be keyed without holding the plaintext. Fast on purpose: this is not a
 * password hash and is never stored — the slow, peppered, salted hash is the
 * one in the database.
 */
export function fingerprint(presented: string): string {
  return createHash('sha256').update(presented, 'utf8').digest('base64url');
}

/** Constant-time comparison for two same-length strings. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

import { decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';

/**
 * The assertion verifier — [ADR-0021](docs/20-decisions/0021-verified-forward-auth-assertion.md)
 * turned into code.
 *
 * The deployment authenticates humans at the gateway and forwards the identity
 * provider's **signed** token upstream beside the plaintext identity headers.
 * prisme verifies that token and ignores the headers entirely. The alternative
 * — trusting `X-Forwarded-User` the way everything else in the cluster does —
 * would make prisme's security a statement about network reachability, and the
 * application namespace has no default-deny policy today (ADR-0021 context).
 *
 * ### The nine rules, and where each one is
 *
 * 1. identity only from the assertion — there is no header path to a verified
 *    subject anywhere in this package; see `apps/api/src/auth/authorizer.ts`
 * 2. the full verification set — {@link verifyAssertion} below, one rejection
 *    per named reason
 * 3. over-long assertions rejected — {@link AssertionRejection.lifetime}
 * 4. the identity key is `sub` — {@link VerifiedAssertion}
 * 5. no prisme session cookie — nothing here sets one, and nothing reads one
 * 6. both tiers verify — this module is the implementation both import
 * 7. assertion and bearer together is a rejection —
 *    `apps/api/src/auth/authorizer.ts`
 * 8. deny-by-default unchanged — scopes are the API's business, not this
 *    package's; see the note on {@link VerifiedAssertion}
 * 9. no development bypass — there is no flag in this file, and no branch that
 *    returns a principal without a signature check
 *
 * ### Why `alg` is checked before a key is fetched
 *
 * `alg` is attacker-controlled: it is a field in the token being verified. The
 * two failures that follow are the classic ones — `none`, which asks the
 * verifier to skip the signature, and an HMAC algorithm, which asks it to use
 * the *public* key as a shared secret. The second is the one that actually
 * turns up here rather than in a textbook: the target provider with no signing
 * keypair falls back to signing with the client secret and advertises HS256
 * (ADR-0021 context). So the allow-list is applied to the decoded header first,
 * before any key material is involved, and it is a fixed asymmetric list that
 * no configuration can widen (`packages/config` refuses a non-asymmetric
 * `AUTH_ALLOWED_ALGS` at boot as well — two layers, on purpose).
 */

/** Asymmetric only, and not configurable. `none` and every HMAC variant fail here. */
const ASYMMETRIC = /^(RS|PS|ES)(256|384|512)$/;

export type AssertionRejectionReason =
  | 'malformed'
  | 'algorithm'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'not_yet_valid'
  | 'lifetime'
  | 'subject'
  | 'claims';

/**
 * A refusal, with a machine-readable reason.
 *
 * The reason is for prisme's own logs and tests. It is deliberately **not**
 * returned to the caller: "wrong audience" and "subject not allow-listed" are
 * different answers, and a caller that can tell them apart can map the
 * configuration by probing (docs/14-threat-model.md §5). The HTTP layer turns
 * every one of these into the same `401`.
 */
export class AssertionRejection extends Error {
  readonly reason: AssertionRejectionReason;

  constructor(reason: AssertionRejectionReason, message: string) {
    super(message);
    this.name = 'AssertionRejection';
    this.reason = reason;
  }
}

export interface AssertionPolicy {
  /** `AUTH_ISSUER_URL`. Compared to `iss` exactly. */
  readonly issuer: string;
  /** `AUTH_AUDIENCE`. Must appear in `aud`, which may be a string or an array. */
  readonly audience: string;
  /** From `AUTH_ALLOWED_ALGS`, intersected with the asymmetric set above. */
  readonly allowedAlgs: readonly string[];
  /** `AUTH_ALLOWED_SUBJECTS`. Empty is a boot failure, never "allow everyone". */
  readonly allowedSubjects: readonly string[];
  readonly clockSkewSeconds: number;
  /** `AUTH_ASSERTION_MAX_LIFETIME`, in seconds. Bounds `exp - iat`. */
  readonly maxLifetimeSeconds: number;
}

/**
 * A resolver from a token's header to the key that should verify it.
 *
 * Aliased so that `apps/api` and `apps/web` never import `jose` themselves:
 * the verifier is this package's job, and a second package reaching for the
 * JOSE library is the first step towards a second implementation of it.
 */
export type KeySource = JWTVerifyGetKey;

export interface VerifyAssertionOptions {
  readonly policy: AssertionPolicy;
  /** The key set. Configuration-derived — never a URL from the request. */
  readonly keys: KeySource;
}

/**
 * The algorithms this verifier will actually accept.
 *
 * The intersection, not the configured list: a deployment can narrow the set,
 * and nothing can widen it past asymmetric. An empty intersection is a
 * configuration that accepts nothing, which fails closed — and which
 * `assertPolicyUsable` turns into a boot failure so it is never discovered one
 * request at a time.
 */
export function effectiveAlgs(policy: AssertionPolicy): readonly string[] {
  return policy.allowedAlgs.filter((alg) => ASYMMETRIC.test(alg));
}

/**
 * Refuse a policy that cannot authenticate anybody.
 *
 * Both of these are silent defaults rather than errors in the provider, which
 * is exactly why they are checked out loud: an empty subject allow-list reads
 * as "no restriction" if you squint, and an all-HMAC algorithm list is what a
 * provider deployed without a signing keypair produces.
 */
export function assertPolicyUsable(policy: AssertionPolicy): void {
  if (policy.allowedSubjects.length === 0) {
    throw new Error(
      'AUTH_ALLOWED_SUBJECTS is empty. An empty allow-list is a boot failure, not "allow everyone"',
    );
  }
  if (effectiveAlgs(policy).length === 0) {
    throw new Error(
      'AUTH_ALLOWED_ALGS leaves no asymmetric algorithm. "none" and every HMAC variant are rejected ' +
        'whatever the provider advertises (ADR-0021 rule 2), so this configuration could never verify anything',
    );
  }
}

function claimString(payload: JWTPayload, name: string): string | undefined {
  const value = payload[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Who the assertion says is asking — and **nothing about what they may do**.
 *
 * This package deliberately knows no scopes. Authorization is prisme's domain
 * and lives in `apps/api` (docs/14-threat-model.md §3, *Why authorization stays
 * in prisme*); a verifier that also decided permissions would be a second place
 * for that decision to live, and the second place is the one that goes wrong.
 *
 * `subject` is `sub` and nothing else (ADR-0021 rule 4). {@link display} is
 * exactly what its name says: material for a UI, never used in a decision. A
 * rename in the identity provider must not silently become a different
 * principal, and must not silently become the *same* one — which is what
 * happens the moment an `email` is used as the key.
 */
export interface VerifiedAssertion {
  readonly subject: string;
  readonly display: AssertionDisplay;
}

export interface AssertionDisplay {
  readonly username?: string | undefined;
  readonly name?: string | undefined;
  readonly email?: string | undefined;
}

function displayOf(payload: JWTPayload): AssertionDisplay {
  return {
    username: claimString(payload, 'preferred_username'),
    name: claimString(payload, 'name'),
    email: claimString(payload, 'email'),
  };
}

/**
 * Verify one assertion, or throw.
 *
 * **Never returns a fallback.** There is no "unverified subject", no anonymous
 * result and no boolean to check — the only way past this function is a
 * {@link VerifiedAssertion} built from a signature that verified, which is what
 * makes the type system a participant in ADR-0021 rule 1.
 *
 * `now` is a parameter rather than a call to `new Date()` so every expiry case
 * is an ordinary unit test instead of a test that sleeps.
 *
 * It is `async` where the brief's contract wrote it synchronous: the key set is
 * fetched, and every JOSE verification primitive is promise-returning. The
 * brief anticipated this ("pure apart from the key-set fetch") and the
 * consequence it cared about holds — with a key set in hand, every rejection
 * below is decided from the token and the policy alone.
 */
export async function verifyAssertion(
  jwt: string,
  now: Date,
  options: VerifyAssertionOptions,
): Promise<VerifiedAssertion> {
  const { policy } = options;
  const algs = effectiveAlgs(policy);
  if (algs.length === 0) {
    throw new AssertionRejection('algorithm', 'no asymmetric algorithm is enabled');
  }

  // Step 1: the header, before anything touches a key.
  let header;
  try {
    header = decodeProtectedHeader(jwt);
  } catch {
    throw new AssertionRejection('malformed', 'the assertion is not a compact JWS');
  }

  const alg = header.alg;
  if (alg === undefined || !ASYMMETRIC.test(alg) || !algs.includes(alg)) {
    // `alg: none` and `alg: HS256` both land here, and they land here *first*.
    throw new AssertionRejection(
      'algorithm',
      `the assertion declares alg ${alg ?? '(absent)'}, which is not an enabled asymmetric algorithm`,
    );
  }

  // Step 2: signature, issuer, audience and the time claims, in one pass.
  // `algorithms` is passed again so the allow-list also binds inside jose —
  // belt and braces, because this is the check whose failure is total.
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(jwt, options.keys, {
      algorithms: [...algs],
      issuer: policy.issuer,
      audience: policy.audience,
      clockTolerance: policy.clockSkewSeconds,
      currentDate: now,
    });
    payload = result.payload;
  } catch (error) {
    throw new AssertionRejection(reasonOf(error), 'the assertion did not verify');
  }

  // Step 3: the claims jose does not police.
  const { exp, iat, sub } = payload;
  if (typeof exp !== 'number') {
    throw new AssertionRejection('claims', 'the assertion has no exp');
  }
  if (typeof iat !== 'number') {
    // Without `iat` the lifetime is unbounded and unknowable. Rejecting is the
    // only honest option: accepting would mean rule 3 silently does not apply
    // to exactly the tokens most likely to be misconfigured.
    throw new AssertionRejection(
      'claims',
      'the assertion has no iat, so its lifetime cannot be bounded',
    );
  }
  if (exp - iat > policy.maxLifetimeSeconds) {
    throw new AssertionRejection(
      'lifetime',
      `the assertion is valid for ${String(exp - iat)}s, beyond the ${String(policy.maxLifetimeSeconds)}s maximum`,
    );
  }

  if (sub === undefined || sub === '') {
    throw new AssertionRejection('claims', 'the assertion has no sub');
  }
  if (!policy.allowedSubjects.includes(sub)) {
    throw new AssertionRejection('subject', 'the subject is not allow-listed');
  }

  return { subject: sub, display: displayOf(payload) };
}

/** jose's error codes, mapped onto prisme's reasons for the log line. */
function reasonOf(error: unknown): AssertionRejectionReason {
  const code = (error as { code?: unknown }).code;
  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return 'expired';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED': {
      const claim = (error as { claim?: unknown }).claim;
      if (claim === 'iss') return 'issuer';
      if (claim === 'aud') return 'audience';
      if (claim === 'nbf') return 'not_yet_valid';
      return 'claims';
    }
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
      return 'signature';
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      return 'algorithm';
    default:
      return 'signature';
  }
}

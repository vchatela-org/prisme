import type { Scope } from '../http/scopes.js';

/**
 * Everything the authentication mechanism persists, and nothing about how.
 *
 * Three tables' worth, and they are here together because they share one
 * property: each is a **security decision that has to survive a restart**. A
 * token minted into a process's memory is a token the next rollout silently
 * revokes; a confirmation token held in memory is a confirmation that two
 * replicas disagree about; a kill switch that forgets it was pulled is not a
 * kill switch.
 *
 * The same port shape as `store/types.ts`, for the same reason: the service
 * above it is the only place a rule lives, and a test can supply an in-memory
 * implementation without inventing a second version of that rule.
 */

export interface ApiTokenRecord {
  readonly id: string;
  /** Operator-supplied label. Display only — never part of a decision. */
  readonly name: string;
  readonly scopes: readonly Scope[];
  readonly createdAt: Date;
  /** The `sub` of the human who minted it. Minting is an authenticated act. */
  readonly createdBy: string;
  readonly expiresAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

/** The record plus its hash. Returned only to the verifier, never to a route. */
export interface ApiTokenSecretRecord extends ApiTokenRecord {
  /** Argon2id, peppered with `TOKEN_PEPPER`. */
  readonly hash: string;
}

export interface CreateTokenInput {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly Scope[];
  readonly hash: string;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly expiresAt: Date;
}

export interface ConfirmationRecord {
  readonly id: string;
  /** Argon2id is unnecessary here: the secret is 256 random bits with a minutes-long life. */
  readonly fingerprint: string;
  /** The hash of the diff this token authorises, and the whole point of it. */
  readonly diffHash: string;
  readonly operation: string;
  readonly subject: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export type WriteSwitchMode = 'outward' | 'all';

export interface WriteSwitchRecord {
  readonly engaged: boolean;
  /** Meaningful only while `engaged`. Retained after release so the audit line reads. */
  readonly mode: WriteSwitchMode;
  /** When the switch last changed, and who changed it — engaging *or* releasing. */
  readonly changedAt: Date | null;
  readonly changedBy: string | null;
  readonly reason: string | null;
}

export interface AuthStore {
  createToken(input: CreateTokenInput): Promise<ApiTokenRecord>;
  findToken(id: string): Promise<ApiTokenSecretRecord | undefined>;
  listTokens(): Promise<readonly ApiTokenRecord[]>;
  /** False when there was no such token, or it was already revoked. */
  revokeToken(id: string, at: Date): Promise<boolean>;
  /** Bulk revocation — docs/14-threat-model.md §3, "revocable individually and in bulk". */
  revokeAllTokens(at: Date): Promise<number>;
  /**
   * Record use. Best effort and deliberately not awaited on the request path:
   * a stale `last_used_at` is a reporting inaccuracy, while a failed write that
   * refuses an otherwise valid request is an outage.
   */
  touchToken(id: string, at: Date): Promise<void>;

  createConfirmation(record: ConfirmationRecord): Promise<void>;
  /**
   * Take the token **and mark it used, atomically**, returning the row *as it
   * was before this call*.
   *
   * Both halves matter. Reading and then marking in two statements is a race
   * that turns a single-use token into a reusable one under exactly the
   * concurrency an agent produces. And returning the prior state is what lets
   * the caller distinguish "already used" from "never existed" — the same row
   * read back after the update would always look freshly consumed.
   *
   * A row is consumed on any *attempt*, including one that then fails on a
   * stale diff. A confirmation that survives a failed use is a confirmation an
   * agent can retry against, which is a brute-force budget.
   */
  consumeConfirmation(id: string, at: Date): Promise<ConfirmationRecord | undefined>;
  deleteExpiredConfirmations(before: Date): Promise<number>;

  readWriteSwitch(): Promise<WriteSwitchRecord>;
  setWriteSwitch(record: WriteSwitchRecord): Promise<WriteSwitchRecord>;
}

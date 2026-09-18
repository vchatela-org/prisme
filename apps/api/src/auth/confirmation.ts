import { createHash, randomBytes } from 'node:crypto';
import { constantTimeEquals, fingerprint } from './token-format.js';
import type { AuthStore, ConfirmationRecord } from './store.js';

/**
 * The confirmation mechanism — W14 item 4. W06 consumes it; this builds it.
 *
 * ### What is actually being defended against
 *
 * Not a stolen token. The highest-risk path in this system is an MCP agent that
 * holds a perfectly valid write token and has a **confused plan**
 * (apps/api/CLAUDE.md, "the MCP surface is the sharpest edge"). Authentication
 * has nothing to say about that: the agent is who it claims to be, and it is
 * about to restructure a real backlog faster than a human can interrupt it.
 *
 * So the control is a second step that a human reads. Every write tool is
 * dry-run by default and returns a diff; executing it requires a token that
 * refers to **that diff**.
 *
 * ### Bound to the diff, not to the session
 *
 * The brief is emphatic and the reason is worth keeping in front of anyone
 * editing this file: *a token authorising "whatever apply does next" is a round
 * trip, not a control*. If the confirmation were bound to a session, or to an
 * operation name, or to a request id, then the sequence
 *
 *     plan  →  (the world changes)  →  apply
 *
 * would apply a diff nobody ever saw. Binding to {@link hashPlan} of the diff
 * closes it by construction: `apply` recomputes the plan against the world as
 * it is now, and if anything moved the hash no longer matches the token. That
 * is also precisely why the level-triggered reconciler (ADR-0009) makes this
 * cheap — it always recomputes rather than replaying, so "the plan as it is
 * now" is a thing it already has.
 *
 * Single-use, and consumed atomically. A confirmation that can be replayed is a
 * confirmation that applies the same diff twice.
 */

export const CONFIRMATION_PREFIX = 'prisme_cnf_';

/** Two minutes: long enough for a human to read a diff, short enough to be a window. */
export const CONFIRMATION_TTL_SECONDS = 120;

const SHAPE = new RegExp(`^${CONFIRMATION_PREFIX}([A-Za-z0-9_-]{16})\\.([A-Za-z0-9_-]{43})$`);

/**
 * A stable hash of a plan.
 *
 * Canonical JSON with sorted keys, because `JSON.stringify` preserves insertion
 * order: the same plan built by two code paths would otherwise hash
 * differently, and a confirmation that fails for that reason is indistinguishable
 * from one that fails because the world moved — which would train whoever sees
 * it to retry until it works.
 */
export function hashPlan(plan: unknown): string {
  return createHash('sha256').update(canonical(plan), 'utf8').digest('base64url');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`);
  return `{${entries.join(',')}}`;
}

export type ConfirmationRejectionReason =
  | 'malformed'
  | 'unknown'
  | 'secret'
  | 'consumed'
  | 'expired'
  | 'stale'
  | 'subject';

export class ConfirmationRejection extends Error {
  readonly reason: ConfirmationRejectionReason;

  constructor(reason: ConfirmationRejectionReason, message: string) {
    super(message);
    this.name = 'ConfirmationRejection';
    this.reason = reason;
  }
}

export interface IssueConfirmationInput {
  /** What it authorises, for the audit line. Never used to decide anything. */
  readonly operation: string;
  /** {@link hashPlan} of the diff shown to the human. */
  readonly diffHash: string;
  /** The principal that ran the dry run. The same one must execute it. */
  readonly subject: string;
}

export interface IssuedConfirmation {
  readonly token: string;
  readonly expiresAt: Date;
  readonly diffHash: string;
}

export interface ConfirmationServiceOptions {
  readonly store: AuthStore;
  readonly now: () => Date;
  readonly random?: ((size: number) => Buffer) | undefined;
}

export interface ConfirmationService {
  issue(input: IssueConfirmationInput): Promise<IssuedConfirmation>;
  /**
   * Consume a confirmation for exactly this diff, or throw.
   *
   * The brief's contract writes this `verifyConfirmation(token, diffHash):
   * boolean`. It returns the record instead: a boolean cannot say *why*, and
   * "the world moved" and "that token was already used" are different things to
   * put in an audit line. The false case is still a single call site — the
   * throw — rather than something a caller can forget to check, which a boolean
   * very much is.
   */
  verify(token: string, diffHash: string, subject: string): Promise<ConfirmationRecord>;
}

export function createConfirmationService(
  options: ConfirmationServiceOptions,
): ConfirmationService {
  const random = options.random ?? randomBytes;

  return {
    async issue(input: IssueConfirmationInput): Promise<IssuedConfirmation> {
      const id = random(12).toString('base64url');
      const secret = random(32).toString('base64url');
      const token = `${CONFIRMATION_PREFIX}${id}.${secret}`;
      const issuedAt = options.now();
      const expiresAt = new Date(issuedAt.getTime() + CONFIRMATION_TTL_SECONDS * 1000);

      await options.store.createConfirmation({
        id,
        fingerprint: fingerprint(token),
        diffHash: input.diffHash,
        operation: input.operation,
        subject: input.subject,
        issuedAt,
        expiresAt,
        consumedAt: null,
      });

      return { token, expiresAt, diffHash: input.diffHash };
    },

    async verify(token: string, diffHash: string, subject: string): Promise<ConfirmationRecord> {
      const match = SHAPE.exec(token.trim());
      if (!match) throw new ConfirmationRejection('malformed', 'not a confirmation token');

      const now = options.now();
      // Consume first, and atomically. Reading then marking is a race that
      // makes a single-use token reusable under exactly the concurrency an
      // agent produces.
      const record = await options.store.consumeConfirmation(match[1] as string, now);
      if (record === undefined) throw new ConfirmationRejection('unknown', 'no such confirmation');
      if (record.consumedAt !== null) {
        throw new ConfirmationRejection('consumed', 'that confirmation has already been used');
      }
      if (!constantTimeEquals(record.fingerprint, fingerprint(token))) {
        throw new ConfirmationRejection('secret', 'the confirmation secret does not match');
      }
      if (record.expiresAt.getTime() <= now.getTime()) {
        throw new ConfirmationRejection('expired', 'the confirmation has expired');
      }
      if (record.subject !== subject) {
        throw new ConfirmationRejection(
          'subject',
          'a confirmation is executed by the principal that planned it',
        );
      }
      if (!constantTimeEquals(record.diffHash, diffHash)) {
        // The important one. Everything above is hygiene; this is the control.
        throw new ConfirmationRejection(
          'stale',
          'the plan has changed since it was shown; run the dry run again and read the new diff',
        );
      }

      return record;
    },
  };
}

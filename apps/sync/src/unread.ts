import { isConnectorError, type ConnectorFailure } from '@prisme/connectors';

/**
 * Why a store was not read, in a form that is safe to print.
 *
 * ### The gap this closes
 *
 * Both callers of a role read — `adoption/run.ts` and `backfill/processes.ts` —
 * swallow the error and report **"not read"**, and they do it deliberately: the
 * message names the role *binding*, which is instance data, and an error is the
 * shortest path from a live workspace into a journal entry
 * (`docs/17-privacy.md` §1, `packages/connectors/src/errors.ts`).
 *
 * The cost is that two very different facts printed the same six characters: a
 * role with **no binding** — a configuration gap to fix in the seed data — and
 * a read that was **refused** — a credential, a permission or an outage to go
 * and look at. Nothing that distinguishes them reached a screen, and the
 * register recorded the gap as real while leaving the swallow in place.
 *
 * ### What may be kept
 *
 * The **failure kind**, and only that. It is a closed set of vendor-vocabulary
 * values — `unbound_role`, `invalid_token`, `refused`, `unavailable` — that
 * `errors.ts` already rules are safe in a message and that are identical for
 * every workspace on earth. It says *why* a read did not happen and nothing
 * about *where* it was pointed, which is exactly the shape the register's row
 * named.
 *
 * An error that is not a `ConnectorError` is `unknown` rather than a guess: the
 * throw could have come from anywhere on the path, and inventing a vendor
 * reason for it would be worse than admitting the read did not classify.
 */
export type UnreadReason = ConnectorFailure | 'unknown';

/** The failure kind of a caught error, or `unknown` when it is not one of ours. */
export function unreadReason(error: unknown): UnreadReason {
  return isConnectorError(error) ? error.failure : 'unknown';
}

/**
 * `1 unbound_role, 3 refused` — reasons and counts, never an identifier.
 *
 * Sorted by kind so two runs over an unchanged world print the same line, and
 * the same order regardless of which role happened to be scanned first.
 *
 * **Counts rather than role keys**, although the keys would be safe — they are
 * prisme's own vocabulary, not the workspace's, and the header already prints
 * them for the stores that *were* read. The question the row asks is *why*, and
 * a count per reason answers it: one `unbound_role` is a store nobody bound,
 * four of them is a seed file that was never loaded. Naming each role would
 * make the line longer without making that judgement different.
 */
export function summariseUnread(reasons: readonly UnreadReason[]): string {
  const counts = new Map<UnreadReason, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);

  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([reason, count]) => `${String(count)} ${reason}`)
    .join(', ');
}

/**
 * The `document tool` line of a report, given what was read and what was not.
 *
 * One function so the two callers cannot drift into printing the same fact two
 * ways — and so the `unbound` case, which is not a failure, never disappears
 * from a line that has other stores in it.
 */
export function documentToolLine(read: readonly string[], unread: readonly UnreadReason[]): string {
  if (unread.length === 0) {
    return read.length === 0 ? 'not read' : read.join('   ');
  }

  const why = summariseUnread(unread);
  return read.length === 0 ? `not read — ${why}` : `${read.join('   ')}   not read — ${why}`;
}

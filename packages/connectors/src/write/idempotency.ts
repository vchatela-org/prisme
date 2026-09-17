import { contentHash } from '../hash.js';
import type { IdempotencyKey } from './types.js';

/**
 * Idempotency keys, derived rather than random.
 *
 * The task tool identifies a command by a UUID the client generates. Two
 * properties are needed and they pull in opposite directions:
 *
 *   1. **A retry of one write must carry the same key**, or a timeout that was
 *      really a success applies the change twice.
 *   2. **A later decision to write the same value again must carry a different
 *      key**, or the tool discards it as a duplicate and prisme silently stops
 *      converging — the failure mode docs/16-sync.md §1 exists to avoid.
 *
 * Both hold if the key is a hash of the run id and the operation: stable inside
 * a pass, including across every HTTP retry, and different in the next pass. A
 * pass re-plans from observed state first (docs/16-sync.md §3), so a new key can
 * only ever accompany a change that is genuinely still outstanding.
 */

/**
 * A UUID-shaped rendering of a hash.
 *
 * The tool requires the UUID *shape*; it does not require randomness, and there
 * is none here on purpose. Version 4 and the RFC variant bits are set so the
 * value parses as a UUID everywhere it is read.
 */
function asUuid(hex: string): string {
  const digits = hex.slice(0, 32).split('');
  digits[12] = '4';
  digits[16] = (((Number.parseInt(digits[16] as string, 16) & 0x3) | 0x8) >>> 0).toString(16);
  const value = digits.join('');
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20, 32),
  ].join('-');
}

/**
 * The key for one write.
 *
 * `runId` scopes it to a pass; `operation` and `subject` name what is being
 * done and to what; `payload` distinguishes two different changes to the same
 * subject in the same pass.
 */
export function idempotencyKey(input: {
  readonly runId: string;
  readonly operation: string;
  readonly subject: string;
  readonly payload?: unknown;
}): IdempotencyKey {
  return asUuid(
    contentHash({
      runId: input.runId,
      operation: input.operation,
      subject: input.subject,
      payload: input.payload ?? null,
    }),
  );
}

/** Whether a string is a UUID the tool will accept. Used by the writer's own assertions. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

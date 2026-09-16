/**
 * Retry timing. Pure, so the whole of it is testable without waiting.
 *
 * Full jitter rather than a fixed exponential: a bounded `random()` multiplier
 * over the exponential ceiling. With one caller this looks like superstition,
 * and it is nearly free — but the same library runs in the scheduled pass and
 * behind the force-sync button (docs/16-sync.md §7), so two runs *can* back off
 * against the same API at the same moment, and lock-step retries are how a
 * recoverable blip turns into a rate-limit.
 */

export interface RetryPolicy {
  /** Total attempts including the first. 1 disables retrying. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/**
 * Delay before attempt `attempt + 1`, given that `attempt` just failed.
 *
 * `random` is a parameter: a test asserts the exact ceiling by passing `() => 1`
 * and the exact floor with `() => 0`, and neither has to sleep.
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy, random: () => number): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const ceiling = Math.min(policy.maxDelayMs, exponential);
  return Math.round(ceiling * Math.min(1, Math.max(0, random())));
}

/** An hour. A `Retry-After` beyond this is not something a 15-minute pass waits out. */
const MAX_RETRY_AFTER_MS = 3_600_000;

/**
 * `Retry-After`, in milliseconds, or `undefined` when there is nothing usable.
 *
 * Both forms in the specification are accepted: delta-seconds, and an HTTP
 * date. The date form needs `now` passed in rather than read, so a test can
 * pin it. A value in the past is clamped to zero rather than rejected — a
 * server whose clock is behind is still telling us it is rate limiting.
 */
export function retryAfterMs(header: string | undefined, now: Date): number | undefined {
  if (header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed === '') return undefined;

  if (/^\d+$/.test(trimmed)) {
    return Math.min(MAX_RETRY_AFTER_MS, Number.parseInt(trimmed, 10) * 1000);
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - now.getTime()));
}

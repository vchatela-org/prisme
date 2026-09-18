/**
 * Rate limiting, per token and per verified subject — W14 item 8.
 *
 * ### What it is for here
 *
 * Not a traffic-shaping feature. prisme has one human user, so a limit on the
 * human path is a blast-radius control rather than a capacity one: it bounds
 * what a *stolen* assertion can do inside its replay window. The token path is
 * the one that earns it day to day — an MCP agent in a loop is the normal
 * failure mode of an MCP agent, and a loop against a write endpoint is the
 * sharpest edge in the system.
 *
 * ### Keyed after authentication, on purpose
 *
 * Keying on client address would be keying on the gateway, which every human
 * request shares. Keying on the credential means one runaway agent is throttled
 * and nothing else is. The cost is that an unauthenticated flood is not limited
 * here — that is the gateway's job, and pretending otherwise would put a
 * per-credential map in the path of exactly the traffic that has no credential.
 *
 * ### One process, deliberately
 *
 * A shared limiter would need Redis, and docs/15-runtime.md lists no such
 * dependency: everything prisme has lives in PostgreSQL (ADR-0018). A
 * per-replica limiter on a single-replica deployment is the same limiter; on
 * two replicas it is twice as generous, which is a documented approximation
 * rather than a hole. Doing it in PostgreSQL would put a write on every request
 * to save an inaccuracy nobody would notice.
 */

export interface RateLimitPolicy {
  /** Tokens added per second, and the steady-state rate. */
  readonly ratePerSecond: number;
  /** Bucket depth, and therefore the size of a burst. */
  readonly burst: number;
}

/**
 * Writes are an order of magnitude scarcer than reads, because the thing being
 * bounded is not load, it is how much a confused caller can change per minute.
 */
export const DEFAULT_RATE_LIMITS = {
  read: { ratePerSecond: 20, burst: 120 },
  write: { ratePerSecond: 2, burst: 20 },
} as const satisfies Record<string, RateLimitPolicy>;

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the next request would be admitted. For `Retry-After`. */
  readonly retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimiter {
  take(key: string, policy: RateLimitPolicy, now: Date): RateLimitDecision;
  /** Drops buckets nothing has touched for a while. Called on a timer by the caller. */
  sweep(now: Date): void;
}

const IDLE_EVICTION_MS = 10 * 60 * 1000;
const MAX_BUCKETS = 10_000;

export function createRateLimiter(): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    take(key: string, policy: RateLimitPolicy, now: Date): RateLimitDecision {
      const nowMs = now.getTime();
      const bucket = buckets.get(key) ?? { tokens: policy.burst, updatedAt: nowMs };

      // Refill by elapsed time rather than on a timer: a bucket that nobody
      // touches costs nothing, and there is no interval to leak.
      const elapsed = Math.max(0, nowMs - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(policy.burst, bucket.tokens + elapsed * policy.ratePerSecond);
      bucket.updatedAt = nowMs;

      if (bucket.tokens < 1) {
        const wait = (1 - bucket.tokens) / policy.ratePerSecond;
        buckets.set(key, bucket);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(wait)) };
      }

      bucket.tokens -= 1;
      if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
        // Full, and this is a key we have not seen. Refusing to track it is
        // better than evicting an established bucket, which is how a flood of
        // fresh keys resets everyone else's limit.
        return { allowed: true, retryAfterSeconds: 0 };
      }
      buckets.set(key, bucket);
      return { allowed: true, retryAfterSeconds: 0 };
    },

    sweep(now: Date): void {
      const cutoff = now.getTime() - IDLE_EVICTION_MS;
      for (const [key, bucket] of buckets) {
        if (bucket.updatedAt < cutoff) buckets.delete(key);
      }
    },
  };
}

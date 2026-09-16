import { z } from 'zod';
import { InvariantError } from './errors.js';

/**
 * The scoring scale is a closed set: 1 · 2 · 3 · 5 · 8 · 13.
 *
 * Modelled as a union rather than `number` so an invalid 4 or 6 cannot be
 * constructed (packages/domain/CLAUDE.md, conventions). The scale is not a
 * stylistic choice: a 1–4 scale divided by a 1–4 scale yields 11 distinct
 * values for 16 combinations, so ties are everywhere and the ranking carries
 * almost no information — docs/12-scoring.md §3.
 */
export const FIBONACCI_SCALE = [1, 2, 3, 5, 8, 13] as const;

export type Fibonacci = (typeof FIBONACCI_SCALE)[number];

const MEMBERS: ReadonlySet<number> = new Set<number>(FIBONACCI_SCALE);

export function isFibonacci(value: number): value is Fibonacci {
  return MEMBERS.has(value);
}

export function parseFibonacci(value: number): Fibonacci {
  if (!isFibonacci(value)) {
    throw new InvariantError(
      'invalid_fibonacci',
      `${value} is not on the scoring scale — it must be one of ${FIBONACCI_SCALE.join(', ')}`,
    );
  }
  return value;
}

/**
 * The next value up the scale, or `undefined` at the ceiling. Used by the
 * monotonicity tests, which walk the whole closed domain rather than sampling
 * it.
 */
export function nextFibonacci(value: Fibonacci): Fibonacci | undefined {
  return FIBONACCI_SCALE[FIBONACCI_SCALE.indexOf(value) + 1];
}

export const fibonacciSchema: z.ZodType<Fibonacci> = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
  z.literal(8),
  z.literal(13),
]);

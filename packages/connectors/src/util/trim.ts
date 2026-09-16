/**
 * Trimming, done by scanning rather than by regular expression.
 *
 * `value.replace(/[.,!?]+$/, '')` reads better and is quadratic: an anchored
 * `+` over a character class makes the engine retry from every starting
 * position, so a paragraph ending in a hundred thousand exclamation marks
 * becomes a stall. That paragraph arrives from a third-party tool
 * (docs/14-threat-model.md §2 ⑤), and a stall inside a pass holds the advisory
 * lock against every later run.
 *
 * CodeQL's `js/polynomial-redos` found all three uses of that idiom in this
 * package. This is the replacement, and it is linear.
 */
export function trimTrailing(value: string, characters: string): string {
  let end = value.length;
  while (end > 0 && characters.includes(value.charAt(end - 1))) end -= 1;
  return value.slice(0, end);
}

/**
 * How a typed query ranks a command or an option. Pure, so it can be tested
 * exhaustively rather than by opening the palette and squinting.
 *
 * The ordering is deliberate and comes from what a palette is *for*: you
 * already know the name of the thing you want and you are typing the fewest
 * characters that will get you there. So an exact match beats a prefix, a
 * prefix beats the start of a later word ("bal" → "Area **bal**ance"), and a
 * scattered subsequence ("arbl" → "**AR**ea **B**a**L**ance") comes last but
 * still counts, because it is how people type fast.
 *
 * Returns 0 for "no match", which is the contract `cmdk` expects.
 */
export function commandScore(
  value: string,
  query: string,
  keywords: readonly string[] = [],
): number {
  const haystack = value.toLowerCase();
  const needle = query.trim().toLowerCase();

  if (needle === '') return 1;

  const direct = scoreOne(haystack, needle);
  if (direct > 0) return direct;

  // Keywords are aliases — "palette" finding "Command menu". They score below
  // any direct match so a real title always outranks somebody else's alias.
  for (const keyword of keywords) {
    if (scoreOne(keyword.toLowerCase(), needle) > 0) return 0.2;
  }

  return 0;
}

function scoreOne(haystack: string, needle: string): number {
  if (haystack === needle) return 1;
  if (haystack.startsWith(needle)) return 0.9;

  // The start of any later word: split on the separators an interface
  // actually uses, not just spaces.
  for (const word of haystack.split(/[\s\-_/·:]+/)) {
    if (word.startsWith(needle)) return 0.7;
  }

  if (haystack.includes(needle)) return 0.5;
  if (isSubsequence(haystack, needle)) return 0.3;

  return 0;
}

/** Every character of `needle`, in order, somewhere in `haystack`. */
function isSubsequence(haystack: string, needle: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

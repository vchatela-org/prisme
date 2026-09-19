import { normalise } from './normalise.js';

/**
 * Fuzzy title similarity — rule 4 of docs/13-migration.md §3, the weakest rule
 * and the only one that can invent a relationship that was never there.
 *
 * It produces a **suggestion with its score visible**, never a link. ADR-0010
 * is explicit about why: "an automatic fuzzy match that is wrong produces
 * exactly the corruption this guards against, and does it invisibly." So the
 * number is carried all the way to the screen, and the rule's confidence is
 * `low` by construction — {@link RULE_CONFIDENCE} has no other value for it.
 *
 * **Sørensen–Dice over character bigrams**, on the normalised form. Chosen over
 * edit distance because it is length-insensitive in the direction that matters
 * here: `Réparer le vélo` and `Réparer le vélo de route` share most of their
 * bigrams, where Levenshtein charges the full length of the suffix. It is also
 * symmetric, bounded in 0–1 with no scaling to argue about, and about ten lines
 * — a similarity function nobody can read is one nobody can set a threshold
 * for.
 *
 * No dependency. A string-similarity package would be a third-party module
 * reachable from the code path that decides what a real backlog *is*, to save
 * the twenty lines below.
 */

/**
 * The floor for showing a suggestion at all.
 *
 * Set conservatively and deliberately high (the brief: "set the threshold
 * conservatively and make a human confirm"). Below this the suggestion is worse
 * than nothing — it is a wrong answer in the position where a human's eye
 * expects the right one, and confirming it is one click.
 *
 * Raising this number is always safe. Lowering it is a decision about somebody's
 * real task list.
 */
export const FUZZY_THRESHOLD = 0.82;

/** Character bigrams of a string. `vélo` → `ve`, `el`, `lo` after normalisation. */
export function bigrams(value: string): readonly string[] {
  const pairs: string[] = [];
  // Array.from, not indexing: a code point outside the BMP is one character and
  // splitting it produces two halves that match nothing.
  const characters = Array.from(value);
  for (let index = 0; index + 1 < characters.length; index += 1) {
    pairs.push(`${characters[index] as string}${characters[index + 1] as string}`);
  }
  return pairs;
}

/**
 * Sørensen–Dice coefficient over the bigrams of two normalised titles, 0–1.
 *
 * Multiset intersection, not set: `aa` in `aaa` and `aaaa` should not score 1.
 * Two titles of one character each are compared for equality, because neither
 * has a bigram and a coefficient over two empty sets is not a similarity.
 */
export function similarity(left: string, right: string): number {
  const a = normalise(left);
  const b = normalise(right);
  if (a === '' || b === '') return 0;
  if (a === b) return 1;

  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  if (leftPairs.length === 0 || rightPairs.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const pair of leftPairs) counts.set(pair, (counts.get(pair) ?? 0) + 1);

  let shared = 0;
  for (const pair of rightPairs) {
    const remaining = counts.get(pair) ?? 0;
    if (remaining > 0) {
      counts.set(pair, remaining - 1);
      shared += 1;
    }
  }

  return (2 * shared) / (leftPairs.length + rightPairs.length);
}

/** Rounded to the three decimals `adoption_candidate.similarity` stores. */
export function roundSimilarity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

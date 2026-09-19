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
 * **Sørensen–Dice over character bigrams**, on the normalised form: symmetric,
 * bounded in 0–1 with no scaling to argue about, and short enough to read — a
 * similarity function nobody can read is one nobody can set a threshold for.
 *
 * And a **second, harder test on top of it**, because a character-level score
 * alone is not safe here. `Review the 2026 budget` and `Review the 2027 budget`
 * score 0.90: nineteen characters of agreement drown the one character that is
 * the entire difference between two annual reviews. Any threshold high enough
 * to separate that pair rejects every real near-match as well. So
 * {@link fuzzyMatch} requires the score **and** {@link titlesAgree}, which
 * compares titles as words rather than as strings:
 *
 *   - **Numbers must be identical.** A digit in a title is a year, an amount or
 *     a version, and a different one is a different thing.
 *   - **A word on one side and not the other must have a near-twin on the
 *     other** — `shed`/`sheds` does, `nord`/`sud` does not — unless it is a
 *     stop word, which carries no identity at all.
 *
 * This makes rule 4 narrow: it catches inflection, typos and a dropped article,
 * and not much else. That is the intended direction. A suggestion that never
 * appears costs one manual review; a suggestion that is wrong costs exactly the
 * corruption ADR-0010 exists to prevent, and it is confirmed with one click.
 *
 * No dependency. A string-similarity package would be a third-party module
 * reachable from the code path that decides what a real backlog *is*, to save
 * the forty lines below.
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

/**
 * Words that carry no identity, so gaining or losing one is not a difference.
 *
 * French and English, because the instance's data is French and the vocabulary
 * is English (CLAUDE.md §4). Deliberately short: a word list is a place where
 * "just one more" eventually removes a word that *was* the difference. Nothing
 * here is longer than three letters and nothing here is a noun.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  // French
  'le',
  'la',
  'les',
  'un',
  'une',
  'de',
  'du',
  'des',
  'd',
  'l',
  'au',
  'aux',
  'et',
  'en',
  'a',
  'ma',
  'mon',
  'mes',
  'sa',
  'son',
  'ses',
  // English
  'the',
  'an',
  'of',
  'to',
  'for',
  'and',
  'in',
  'on',
  'my',
  'at',
]);

/** How close two words must be to count as the same word, inflected. */
const TOKEN_MATCH = 0.6;

const HAS_DIGIT = /\d/u;

function tokens(title: string): readonly string[] {
  const normalised = normalise(title);
  return normalised === '' ? [] : normalised.split(' ');
}

/** Multiset difference: what is in `from` beyond what `other` covers. */
function beyond(from: readonly string[], other: readonly string[]): readonly string[] {
  const remaining = new Map<string, number>();
  for (const token of other) remaining.set(token, (remaining.get(token) ?? 0) + 1);
  const extra: string[] = [];
  for (const token of from) {
    const left = remaining.get(token) ?? 0;
    if (left > 0) remaining.set(token, left - 1);
    else extra.push(token);
  }
  return extra;
}

function sortedDigitTokens(all: readonly string[]): readonly string[] {
  return all.filter((token) => HAS_DIGIT.test(token)).sort();
}

/**
 * Do two titles agree about what they are *about*?
 *
 * Word-level, and deliberately unforgiving. Returns false the moment one side
 * says something the other does not, which is the answer that sends a candidate
 * to the manual remainder — where a human reads both titles and decides.
 */
export function titlesAgree(left: string, right: string): boolean {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;

  // A differing number is a differing thing: 2026 and 2027, v1 and v2, 10k and
  // 21k. No amount of surrounding agreement makes up for it.
  const leftDigits = sortedDigitTokens(leftTokens);
  const rightDigits = sortedDigitTokens(rightTokens);
  if (leftDigits.join(' ') !== rightDigits.join(' ')) return false;

  const onlyLeft = beyond(leftTokens, rightTokens).filter((token) => !STOP_WORDS.has(token));
  const onlyRight = beyond(rightTokens, leftTokens).filter((token) => !STOP_WORDS.has(token));

  // Every word unique to one side needs a near-twin unique to the other:
  // `shed`/`sheds` is one word inflected, `nord`/`sud` is two words.
  const paired = new Set<number>();
  for (const token of onlyLeft) {
    const index = onlyRight.findIndex(
      (other, position) => !paired.has(position) && similarity(token, other) >= TOKEN_MATCH,
    );
    if (index === -1) return false;
    paired.add(index);
  }
  return paired.size === onlyRight.length;
}

/**
 * Rule 4, whole: the score if the two titles both clear the threshold **and**
 * agree as words, otherwise nothing.
 *
 * One function so that nowhere in the codebase can apply the threshold without
 * the agreement test — the pair is the control, and half of it is not.
 */
export function fuzzyMatch(
  left: string,
  right: string,
  threshold: number = FUZZY_THRESHOLD,
): number | undefined {
  const score = similarity(left, right);
  if (score < threshold) return undefined;
  if (!titlesAgree(left, right)) return undefined;
  return score;
}

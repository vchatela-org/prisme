/**
 * Title normalisation — rule 3 of docs/13-migration.md §3.
 *
 * "Normalised title match (case, accents, punctuation, leading numbering)."
 * Each of those four is a separate step below, because each is a separate
 * judgement about what two people writing the same title would differ on, and
 * a single unreadable regular expression hides which one is wrong.
 *
 * Normalisation is **lossy on purpose**, which is exactly why a normalised
 * match is `medium` and not `certain`: two genuinely different titles can
 * normalise to the same string, and the human who confirms the proposal is the
 * control for that. Nothing in this file should ever be used to auto-link.
 *
 * The instance's data is French; the domain vocabulary is English (CLAUDE.md
 * §4). Accent folding is therefore load-bearing rather than cosmetic — `Résumé`
 * and `Resume` are the same title typed on two keyboards.
 */

/**
 * Leading numbering, as four separate shapes rather than one regular
 * expression nobody can check against the four examples in the spec:
 *
 * | Shape | Matches |
 * |---|---|
 * | ordinal | `1.`, `2)`, `03 -`, `IV.`, `a)` — a counter *and* its separator |
 * | hash | `#4`, `# 12` — the separator is the hash, so none is needed after |
 * | bullet | `-`, `*`, `•`, `–` followed by a space |
 *
 * All anchored, and only one is applied, so `1. 2. keep going` loses only the
 * first. A title that is *entirely* numbering keeps it — see {@link normalise}.
 *
 * The counter must be followed by a separator. Without that requirement `2026
 * objectives` loses its year, which is the difference between two annual
 * reviews.
 */
const LEADING_NUMBERING = new RegExp(
  [
    // ordinal: an arabic number, a short roman numeral, or a single letter,
    // then one of `)`, `.`, `:` or a dash, then space.
    String.raw`^\s*(?:\d{1,3}|[ivxIVX]{1,5}|[a-zA-Z])\s*[).:\-–—]\s+`,
    // hash-numbered
    String.raw`^\s*#\s*\d{1,3}[).:\-–—]?\s+`,
    // bullet
    String.raw`^\s*[-*•–—]\s+`,
  ].join('|'),
  'u',
);

/** Anything that is not a letter, a number or a space, once accents are gone. */
const PUNCTUATION = /[^\p{L}\p{N}\s]+/gu;

const WHITESPACE = /\s+/gu;

/** Combining marks left behind by NFD decomposition. */
const COMBINING_MARKS = /\p{M}+/gu;

export function foldAccents(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC');
}

export function stripLeadingNumbering(value: string): string {
  const stripped = value.replace(LEADING_NUMBERING, '');
  // A title that is nothing but its numbering keeps it. `4.` normalising to the
  // empty string would make every such title match every other one, which is
  // the worst possible failure for a rule whose output a human confirms.
  return stripped.trim() === '' ? value : stripped;
}

/**
 * The comparison form: accents folded, numbering dropped, punctuation removed,
 * whitespace collapsed, lower-cased.
 *
 * Order matters. Punctuation is removed *after* the numbering, because the
 * numbering is recognised by its punctuation.
 */
export function normalise(title: string): string {
  const withoutNumbering = stripLeadingNumbering(title);
  const folded = foldAccents(withoutNumbering);
  return folded.replace(PUNCTUATION, ' ').replace(WHITESPACE, ' ').trim().toLowerCase();
}

/**
 * Rule 2's comparison form: exact, but not *byte* exact.
 *
 * Leading and trailing whitespace and a stray double space are typing, not
 * meaning, and Unicode normalisation is invisible in every editor there is —
 * two strings that render identically are the same title, whatever their code
 * points say. Case, accents and punctuation all still count here; that is what
 * separates rule 2 from rule 3.
 */
export function exactForm(title: string): string {
  return title.normalize('NFC').replace(WHITESPACE, ' ').trim();
}

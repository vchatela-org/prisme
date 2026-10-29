/**
 * Title normalisation — rule 3 of docs/13-migration.md §3, and the comparison
 * every rule that asks "is this the same title?" uses: adoption's identity
 * resolution, and the key-result hint on an initiative (`key-result-hint.ts`).
 * One implementation, so the queue and the hint cannot disagree about whether
 * two titles match.
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
 * first. A title that is *entirely* numbering keeps it — see {@link normaliseTitle}.
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
export function normaliseTitle(title: string): string {
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
export function exactTitleForm(title: string): string {
  return title.normalize('NFC').replace(WHITESPACE, ' ').trim();
}

/**
 * Inline markup the task tool renders and does not show: emphasis and
 * strike-through markers, and a link drawn as its text. Removed pairwise, so a
 * lone `*` that is content (`5 * 3`) survives.
 */
const EMPHASIS = /(\*\*|__|~~)([^\n]{1,500}?)\1/gu;
// Neither bracket in the text and no parenthesis in the address, both bounded:
// a title is third-party input, and a looser pattern backtracks polynomially on
// a run of `[` or `](` (CodeQL js/polynomial-redos).
const LINK = /\[([^[\]\n]{0,500})\]\([^()\s]{0,2000}\)/gu;

/** Longer than any real task title; beyond it, the title is compared as it stands. */
const RENDER_LIMIT = 2000;

/**
 * Rule 2's form of the title as it **reads**: {@link exactTitleForm} after the
 * inline markup is gone. `**KR1** : Ship it` and `KR1 : Ship it` render as the
 * same words in the task tool, so they are the same title; case, accents and
 * punctuation still count, which is what keeps this exact and not rule 3.
 *
 * Used where a person's markup is the only difference between their task and
 * prisme's wording (ADR-0039) — never as a substitute for {@link normaliseTitle}.
 */
export function renderedTitleForm(title: string): string {
  if (title.length > RENDER_LIMIT) return exactTitleForm(title);
  const unlinked = title.replace(LINK, '$1');
  let previous: string;
  let current = unlinked;
  // Nested emphasis (`**__a__**`) comes off one layer per round.
  do {
    previous = current;
    current = current.replace(EMPHASIS, '$2');
  } while (current !== previous);
  return exactTitleForm(current);
}

/** Whether two titles read the same once inline markup is gone. */
export function isSameRenderedTitle(left: string, right: string): boolean {
  return renderedTitleForm(left) === renderedTitleForm(right);
}

/**
 * A title written the way key results are numbered by hand — `KR1 : …`,
 * `**KR 2** - …` — whatever follows. A subtask shaped like this under an
 * objective's task is somebody's key result, matched or not (ADR-0039).
 */
const KEY_RESULT_SHAPE = /^\W*KR\s*\d+\b/iu;

export function looksLikeKeyResult(title: string): boolean {
  return KEY_RESULT_SHAPE.test(renderedTitleForm(title));
}

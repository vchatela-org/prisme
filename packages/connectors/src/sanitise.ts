import { trimTrailing } from './util/trim.js';

/**
 * Sanitisation — the control for boundary ⑤ in docs/14-threat-model.md §2.
 *
 * Data arriving from the owner's own document tool is **not** trusted input. It
 * contains markup, arbitrary URLs and text pasted from the open web, and it
 * flows into rendering *and* into agent context. Two consequences:
 *
 *   - **Nothing here ever emits markup.** A run of rich text becomes plain text
 *     plus a list of marks drawn from a closed allow-list. There is no HTML to
 *     escape because none is produced, which is a stronger guarantee than any
 *     sanitiser: the renderer decides how a `bold` mark looks, and a payload
 *     that was `<img onerror=…>` in the source is just characters here.
 *   - **A URL is collected, never fetched.** {@link isFetchAllowed} denies
 *     everything by default. Content-supplied URLs are the SSRF vector in
 *     docs/14-threat-model.md §5, and "we only fetch the ones we found in the
 *     user's own workspace" is exactly the reasoning that makes it exploitable.
 */

/** The complete set of formatting prisme understands. Anything else is dropped. */
export const ALLOWED_MARKS = ['bold', 'italic', 'strikethrough', 'underline', 'code'] as const;

export type Mark = (typeof ALLOWED_MARKS)[number];

const ALLOWED_MARK_SET: ReadonlySet<string> = new Set(ALLOWED_MARKS);

/** Only these two schemes are ever carried forward. `javascript:` and `data:` are dropped. */
const ALLOWED_URL_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * Characters stripped from every string that crosses this boundary.
 *
 * Done by code point rather than by regular expression, because a regular
 * expression for control characters has to *contain* control characters, and a
 * source file nobody can read is its own kind of hazard.
 *
 *   - C0, DEL and C1, except tab and newline. A carriage return goes too, which
 *     normalises CRLF to LF and stops a line ending from changing a hash.
 *   - The bidirectional marks, embeddings, overrides and isolates. These are
 *     not theoretical: they let a title render right-to-left in a UI and read as
 *     something other than what it is, and they survive every other layer
 *     because they are perfectly legitimate Unicode.
 */
function isStripped(codePoint: number): boolean {
  if (codePoint === 0x09 || codePoint === 0x0a) return false;
  if (codePoint <= 0x1f) return true;
  if (codePoint >= 0x7f && codePoint <= 0x9f) return true;
  if (codePoint === 0x200e || codePoint === 0x200f) return true;
  if (codePoint >= 0x202a && codePoint <= 0x202e) return true;
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return true;
  return false;
}

/**
 * Plain text, safe to put in a log line, a UI or an agent's context.
 *
 * Normalised to NFC so that two spellings of the same string hash the same —
 * without it a title round-tripped through two operating systems produces two
 * different content hashes and an endless stream of phantom changes.
 */
export function sanitisePlainText(raw: string): string {
  let clean = '';
  for (const character of raw.normalize('NFC')) {
    if (!isStripped(character.codePointAt(0) ?? 0)) clean += character;
  }
  return clean;
}

export interface RichTextRun {
  readonly text: string;
  readonly href?: string | null | undefined;
  /** Vendor annotation flags. Only the keys in {@link ALLOWED_MARKS} are read. */
  readonly annotations?: Readonly<Record<string, unknown>> | undefined;
}

export interface TextSegment {
  readonly text: string;
  readonly marks: readonly Mark[];
  readonly href?: string | undefined;
}

export interface SanitisedText {
  /** The whole thing as one string. What a hash, a search or a log line uses. */
  readonly text: string;
  readonly segments: readonly TextSegment[];
  /** Every http(s) URL found, deduplicated, in first-seen order. Never fetched. */
  readonly urls: readonly string[];
}

export const EMPTY_TEXT: SanitisedText = { text: '', segments: [], urls: [] };

/**
 * An http(s) URL, normalised, or `undefined` for anything else.
 *
 * Deliberately an allow-list of schemes. A deny-list here is a list of the
 * schemes someone thought of.
 */
export function safeUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (!ALLOWED_URL_SCHEMES.has(url.protocol)) return undefined;
  return url.toString();
}

/** Bare URLs typed into a paragraph, which carry no `href` of their own. */
const BARE_URL = /https?:\/\/[^\s<>"')\]]+/gi;

export function collectUrls(text: string): readonly string[] {
  const found: string[] = [];
  for (const match of text.matchAll(BARE_URL)) {
    // Trailing sentence punctuation is almost never part of the URL.
    const candidate = safeUrl(trimTrailing(match[0], '.,;:!?'));
    if (candidate !== undefined && !found.includes(candidate)) found.push(candidate);
  }
  return found;
}

function marksOf(annotations: Readonly<Record<string, unknown>> | undefined): readonly Mark[] {
  if (annotations === undefined) return [];
  const marks: Mark[] = [];
  for (const mark of ALLOWED_MARKS) {
    if (ALLOWED_MARK_SET.has(mark) && annotations[mark] === true) marks.push(mark);
  }
  return marks;
}

/**
 * Rich text → plain text, allow-listed marks, and the URLs it mentioned.
 *
 * Empty runs are dropped rather than preserved: they carry no information and
 * they would otherwise make the segment list — and therefore the content hash —
 * depend on how the source tool happened to split its runs that day.
 */
export function sanitiseRichText(runs: readonly RichTextRun[]): SanitisedText {
  const segments: TextSegment[] = [];
  const urls: string[] = [];
  let text = '';

  const addUrl = (candidate: string | undefined): void => {
    if (candidate !== undefined && !urls.includes(candidate)) urls.push(candidate);
  };

  for (const run of runs) {
    const clean = sanitisePlainText(run.text);
    if (clean === '') continue;

    text += clean;
    const href = run.href == null ? undefined : safeUrl(run.href);
    addUrl(href);
    for (const bare of collectUrls(clean)) addUrl(bare);

    segments.push(
      href === undefined
        ? { text: clean, marks: marksOf(run.annotations) }
        : { text: clean, marks: marksOf(run.annotations), href },
    );
  }

  return { text, segments, urls };
}

/** Address literals that must never be reached, allow-list or not. */
const BLOCKED_LITERAL =
  /^(localhost|0\.0\.0\.0|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|169\.254(\.\d{1,3}){2}|\[?::1\]?)$/i;

/** Suffixes that only ever name something inside a private network. */
const BLOCKED_SUFFIXES = ['.internal', '.lan', '.local', '.home.arpa'] as const;

function isBlockedHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (BLOCKED_LITERAL.test(lower)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export interface FetchPolicy {
  /** Exact host matches. Empty — the default — denies everything. */
  readonly allowedHosts?: readonly string[] | undefined;
}

/**
 * Whether a URL found in third-party content may be fetched. **Deny by default.**
 *
 * Loopback, link-local and RFC1918 literals are refused even when allow-listed:
 * the allow-list exists for public documentation hosts, and a private address
 * in it is far more likely to be a mistake than an intention. This is a pure
 * check on the literal host — it cannot see where a name resolves, so it is one
 * layer of the SSRF defence and not the whole of it.
 */
export function isFetchAllowed(raw: string, policy: FetchPolicy = {}): boolean {
  const normalised = safeUrl(raw);
  if (normalised === undefined) return false;

  const host = new URL(normalised).hostname;
  if (isBlockedHost(host)) return false;

  return (policy.allowedHosts ?? []).some(
    (allowed) => allowed.toLowerCase() === host.toLowerCase(),
  );
}

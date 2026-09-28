/**
 * A document-tool identifier, reduced to the form two of them are compared in.
 *
 * The tool writes one page's identifier two ways: dashed (8-4-4-4-12), as its
 * API returns it — in a relation property too — and bare, as 32 hexadecimal
 * digits, the way a copied link carries it. Both name the same page, and a
 * comparison that did not know it would call an area's page and the relation
 * pointing at it strangers (ADR-0033).
 *
 * So a 32-digit identifier, dashed or not, becomes its lower-case bare digits.
 * Anything else — the opaque identifiers the fixtures and the local harness use
 * — is compared as it is, trimmed: stripping its dashes could make two
 * different identifiers equal, which is a false match rather than a missed one.
 *
 * For comparing only. What is stored and what is sent stay as they were given.
 */

const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BARE = /^[0-9a-f]{32}$/i;

export function docIdKey(id: string): string {
  const text = id.trim();
  if (DASHED.test(text) || BARE.test(text)) return text.replaceAll('-', '').toLowerCase();
  return text;
}

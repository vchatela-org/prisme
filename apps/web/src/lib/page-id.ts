/**
 * A document-tool page identifier out of whatever a person pasted.
 *
 * The tool's *Copy link* ends in a 32-digit hexadecimal identifier; its API
 * shows the same identifier dashed. Both come back dashed. Anything else is
 * kept only as an opaque token — the shape fixtures and the local harness use —
 * and refused otherwise. The vendor's URL layout is not interpreted beyond
 * "the identifier is the 32 hex digits in it".
 */
const HEX_ID = /(?:^|[^0-9a-f])([0-9a-f]{32})(?![0-9a-f])/i;
const DASHED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

export function pageIdFrom(raw: string): string | undefined {
  const text = raw.trim();
  if (DASHED_ID.test(text)) return text.toLowerCase();
  const hex = HEX_ID.exec(text)?.[1]?.toLowerCase();
  if (hex !== undefined) {
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  }
  return OPAQUE_ID.test(text) ? text : undefined;
}

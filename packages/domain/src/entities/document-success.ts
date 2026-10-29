/**
 * The document tool's own success figure for an objective (ADR-0042).
 *
 * It is read, and shown beside the status when the owner judges the objective
 * (*the document says 100% — mark met?*). It is never written, never a score,
 * and it does not change the objective's status: closing an objective `met` is
 * a judgement, and ADR-0013 keeps judgements human. The window (ADR-0037) does
 * not read it either.
 */

/** From this percentage up, the document's own figure says the objective was met. */
export const DOCUMENT_SAYS_MET_PCT = 100;

/** Whether a document's figure, as a percentage, reads as met. */
export function documentSaysMet(documentSuccess: number | null | undefined): boolean {
  return (
    documentSuccess !== null &&
    documentSuccess !== undefined &&
    documentSuccess >= DOCUMENT_SAYS_MET_PCT
  );
}

/**
 * How a number property's values read as a percentage, from the format the
 * document tool declares for it:
 *
 * - `percent` is stored as a **fraction** — 1 is shown as 100% — so it is
 *   multiplied by 100;
 * - `number` and `number_with_commas` are plain numbers, read as a percentage
 *   already on a 0–100 scale;
 * - anything else — a currency, above all — is not a success figure, and is
 *   refused rather than guessed at.
 */
export type DocumentSuccessScale = 'fraction' | 'percentage';

export function documentSuccessScale(format: string): DocumentSuccessScale | undefined {
  if (format === 'percent') return 'fraction';
  if (format === 'number' || format === 'number_with_commas') return 'percentage';
  return undefined;
}

/**
 * The figure as a percentage, rounded to two places so a fraction's float
 * noise does not make 1 read as 99.99999%. `undefined` for no value, a value
 * that is not finite, or a negative one: none of those is a success figure.
 */
export function documentSuccessPct(
  value: number | null | undefined,
  scale: DocumentSuccessScale,
): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const pct = scale === 'fraction' ? value * 100 : value;
  return Math.round(pct * 100) / 100;
}

/**
 * Parsing `backfill --from <date>`.
 *
 * Its own module rather than a function in `main.ts` for one practical reason:
 * `main.ts` loads configuration and starts a run at module scope, so importing
 * it from a test would execute the command line. Argument parsing is exactly
 * the kind of thing that is wrong in small ways, so it has to be reachable
 * without that.
 */

/**
 * The start date, or `undefined` if the arguments do not say one.
 *
 * **Required rather than defaulted**, because every plausible default is wrong.
 * A short one quietly backfills a fortnight and leaves the balance factor
 * reading as measured when it rests on almost nothing; a long one pages years
 * off a rate-limited API because somebody typed a bare verb. The caller says
 * how far back they mean.
 */
export function backfillFrom(argv: readonly string[]): Date | undefined {
  const flags = argv.slice(3);
  if (flags.length !== 2 || flags[0] !== '--from') return undefined;

  const value = flags[1] ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;

  const at = new Date(`${value}T00:00:00.000Z`);
  // `new Date('2026-02-31')` is not an error, it is the 3rd of March.
  // Round-tripping is what catches the day that does not exist.
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== value) return undefined;
  return at;
}

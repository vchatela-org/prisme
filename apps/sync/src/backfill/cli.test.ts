import { describe, expect, it } from 'vitest';

import { backfillFrom } from './cli.js';

/** `argv` as node hands it over: `[node, script, command, ...flags]`. */
const argv = (...flags: string[]): string[] => ['node', 'prisme-sync', 'backfill', ...flags];

describe('backfillFrom', () => {
  it('reads a date in the one format it accepts', () => {
    expect(backfillFrom(argv('--from', '2024-01-15'))?.toISOString()).toBe(
      '2024-01-15T00:00:00.000Z',
    );
  });

  it('refuses a bare command, because no default start date is right', () => {
    expect(backfillFrom(argv())).toBeUndefined();
  });

  it('refuses a flag it does not know', () => {
    expect(backfillFrom(argv('--since', '2024-01-15'))).toBeUndefined();
    expect(backfillFrom(argv('--from', '2024-01-15', '--apply'))).toBeUndefined();
  });

  it('refuses a date it would have to interpret', () => {
    expect(backfillFrom(argv('--from', '15/01/2024'))).toBeUndefined();
    expect(backfillFrom(argv('--from', 'last year'))).toBeUndefined();
    expect(backfillFrom(argv('--from', '2024-1-5'))).toBeUndefined();
  });

  /**
   * `new Date('2026-02-31')` is not an error in JavaScript, it is the 3rd of
   * March. A backfill silently starting three days later than asked is the kind
   * of thing nobody would ever notice.
   */
  it('refuses a day that does not exist rather than rolling it forward', () => {
    expect(backfillFrom(argv('--from', '2026-02-31'))).toBeUndefined();
    expect(backfillFrom(argv('--from', '2026-13-01'))).toBeUndefined();
  });

  it('accepts the 29th of February in a leap year', () => {
    expect(backfillFrom(argv('--from', '2024-02-29'))?.toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });
});

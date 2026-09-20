/**
 * Parsing `create --plan | --apply`.
 *
 * Its own module for the reason `backfill/cli.ts` gives: `main.ts` loads
 * configuration and starts a run at module scope, so importing it from a test
 * would execute the command line. Argument parsing is exactly the kind of
 * thing that is wrong in small ways.
 *
 * **The mode is required.** `prisme-sync create` reads like a verb that does
 * something, and what it would do is add objects to a real workspace — so a
 * bare invocation is a usage error rather than a default. The same instinct as
 * `adopt --plan`, which is redundant and required anyway.
 */
export function createMode(argv: readonly string[]): 'plan' | 'apply' | undefined {
  const flags = argv.slice(3);
  if (flags.length !== 1) return undefined;
  if (flags[0] === '--plan') return 'plan';
  if (flags[0] === '--apply') return 'apply';
  return undefined;
}

/**
 * The most creations one pass will attempt.
 *
 * Small on purpose. A ledger holding hundreds of intents means something
 * upstream is wrong, and a pass that drains it silently turns that bug into
 * hundreds of objects in somebody's workspace before anybody reads a log line.
 * Twenty covers a project with a generous set of sections plus a day of
 * captures, and stops short of anything that should be looked at first.
 */
export const DEFAULT_MAX_PER_PASS = 20;

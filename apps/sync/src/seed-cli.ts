/**
 * Argument parsing for the seed path: `bindings --from <path>` and
 * `areas --from <path> [--force]`.
 *
 * Its own module rather than functions in `main.ts`, for the reason
 * [`backfill/cli.ts`](backfill/cli.ts) gives: `main.ts` loads configuration and
 * starts a run at module scope, so importing it from a test would execute the
 * command line. Argument parsing is exactly the kind of thing that is wrong in
 * small ways — a flag accepted where it means nothing, a path taken from the
 * wrong position — so it has to be reachable without that.
 */

/**
 * The seed file a `bindings` run should read.
 *
 * A path rather than a fixed location, for the reason `backfill --from` takes a
 * date: no default is right. The seed directory is gitignored and its mount
 * point is deployment detail ([`docs/17-privacy.md`](../../docs/17-privacy.md)),
 * so this repository must not know one — and a command that silently read
 * nothing from a path that does not exist would look like a success.
 *
 * **Exactly two flags, and they are `--from` and a path.** `bindings` has no
 * `--force`: a role binding is replaced wholesale, so there is nothing for a
 * flag to protect.
 */
export function bindingsFrom(argv: readonly string[]): string | undefined {
  const flags = argv.slice(3);
  if (flags.length !== 2 || flags[0] !== '--from') return undefined;
  return flags[1];
}

export interface AreasArgs {
  readonly path: string;
  /**
   * Replace a year whose stored weights differ from the file's.
   *
   * A flag rather than a default because a weight is fixed for a whole calendar
   * year (ADR-0007): replacing one is a review decision. Re-running the loader
   * unchanged needs no flag — a year the file already agrees with is left alone,
   * which is what makes `pnpm seed:load` safe to run twice.
   */
  readonly force: boolean;
}

/**
 * `areas --from <path>`, with an optional trailing `--force`.
 *
 * The third flag is refused if it is anything else rather than ignored: a
 * mistyped flag that reads as a successful load is the failure mode this whole
 * path exists to close, and a loader is run once, by hand, by somebody who will
 * not read the output twice.
 */
export function areasArgsFrom(argv: readonly string[]): AreasArgs | undefined {
  const flags = argv.slice(3);
  if (flags[0] !== '--from') return undefined;

  const path = flags[1];
  if (path === undefined) return undefined;

  if (flags.length === 2) return { path, force: false };
  if (flags.length === 3 && flags[2] === '--force') return { path, force: true };
  return undefined;
}

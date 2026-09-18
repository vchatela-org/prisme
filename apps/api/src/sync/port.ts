/**
 * `POST /sync`, as a port.
 *
 * The reconciler is a library with two entrypoints — the CronJob binary and
 * this API — and both go through the same advisory lock so the scheduled pass
 * and the force-sync button are provably one code path rather than two
 * implementations that drift (docs/16-sync.md §7, apps/sync/CLAUDE.md).
 *
 * The API declares the shape of a pass here and imports `@prisme/sync` only in
 * `runner.ts`. That keeps the route, the service and their tests free of a
 * network client and a database handle, and it means a test can exercise the
 * *contract* of a forced sync — refused, locked, applied — without either.
 */

export interface SyncRunRequest {
  /** `plan` has no side effects and may run at any time: it is a question. */
  readonly mode: 'plan' | 'apply';
  readonly full: boolean;
}

export interface SyncRunResult {
  readonly mode: 'plan' | 'apply';
  /** False when another pass held the lock. Nothing was queued — see ADR-0009. */
  readonly ran: boolean;
  readonly full: boolean;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly counts: Readonly<Record<string, number>>;
  readonly applied: number | null;
  readonly conflicts: number | null;
  /** The write freeze, or a plan over the create threshold. Both are refusals. */
  readonly refused: string | null;
  readonly failures: number;
  readonly drift: number;
  /**
   * The rendered plan. A user interface in its own right, and it carries real
   * titles: it goes to the authenticated caller and never to a log line.
   */
  readonly report: string | null;
}

export interface SyncRunner {
  run(request: SyncRunRequest): Promise<SyncRunResult>;
}

/**
 * The runner an instance gets when no reconciler is wired in — a test harness,
 * or a deployment without external tokens. It refuses rather than pretending a
 * pass happened with nothing to show for it.
 */
export const UNAVAILABLE_RUNNER: SyncRunner = {
  run: () => Promise.reject(new Error('no reconciler is configured for this instance')),
};

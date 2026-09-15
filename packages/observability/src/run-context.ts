import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Run-ID correlation.
 *
 * docs/15-runtime.md §5 asks for "a run ID correlating every action in a
 * reconciler pass". Threading it through every function signature is how it
 * ends up missing from the one log line that mattered, so it lives in async
 * context and the logger reads it.
 */
export interface RunContext {
  /** Correlates every line emitted during one reconciler pass or one request. */
  readonly runId: string;
  /** What started the run — `cron`, `api`, `http`. Free-form, never user data. */
  readonly source?: string;
}

const storage = new AsyncLocalStorage<RunContext>();

export function newRunId(): string {
  return randomUUID();
}

/** The context of the current run, if there is one. */
export function currentRunContext(): RunContext | undefined {
  return storage.getStore();
}

/** Run `fn` with a run context in scope. Nested calls create a nested context. */
export function withRunContext<T>(context: RunContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Convenience: start a fresh run and execute `fn` inside it. */
export function withNewRun<T>(source: string, fn: (context: RunContext) => T): T {
  const context: RunContext = { runId: newRunId(), source };
  return storage.run(context, () => fn(context));
}

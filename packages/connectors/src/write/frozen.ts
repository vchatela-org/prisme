import { ConnectorError } from '../errors.js';
import type { TaskToolWriter } from './types.js';

/**
 * A writer that refuses everything.
 *
 * The write freeze is a configuration flag (`SYNC_WRITE_ENABLED`, default
 * `false`), and a flag is checked by code that can forget to check it. Handing
 * the frozen writer to `apply` instead makes the freeze structural: there is no
 * path from a mistaken branch to a real API, because the object in hand cannot
 * reach one (docs/13-migration.md §1).
 */
export function createFrozenWriter(reason = 'the write freeze is on'): TaskToolWriter {
  const refuse = (operation: string): Promise<never> =>
    Promise.reject(
      new ConnectorError('refused', `no outward write was attempted: ${reason}`, {
        tool: 'task',
        operation,
      }),
    );

  return {
    createTask: () => refuse('create anchor'),
    updateTask: () => refuse('update task'),
    moveTask: () => refuse('move task'),
  };
}

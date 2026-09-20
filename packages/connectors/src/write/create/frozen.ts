import { ConnectorError } from '../../errors.js';
import type { CreationWriter } from './types.js';

/**
 * A creating writer that refuses everything.
 *
 * The same mechanism as `../frozen.ts`, and the same reason: the write freeze
 * (`SYNC_WRITE_ENABLED`, default `false`) is configuration, and configuration
 * is checked by code that can forget to check it. Handing this object to the
 * converge pass makes the freeze structural — there is no path from a mistaken
 * branch to a real API, because the object in hand cannot reach one
 * (docs/13-migration.md §1).
 *
 * It matters more here than it does for the reconciler. A frozen reconciler
 * that wrongly ran would update fields on objects that already exist; a frozen
 * creator that wrongly ran would *add* objects to a workspace, which is the
 * failure mode ADR-0010 is written about.
 */
export function createFrozenCreationWriter(reason = 'the write freeze is on'): CreationWriter {
  const refuse = (operation: string): Promise<never> =>
    Promise.reject(
      new ConnectorError('refused', `nothing was created: ${reason}`, {
        tool: 'task',
        operation,
      }),
    );

  return {
    createProject: () => refuse('create project'),
    createSection: () => refuse('create section'),
    createLooseTask: () => refuse('create capture task'),
  };
}

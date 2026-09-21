import { ConnectorError } from '../../errors.js';
import type { CreationWriter, DocumentCreationWriter } from './types.js';

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

/**
 * The document tool's frozen writer: the same mechanism, the same reason.
 *
 * It matters even more here than for the task tool. A frozen creator that
 * wrongly ran would add a task; this one would add a page to a knowledge base
 * somebody reads, and the page it added would be a copy of a template — so the
 * mistake is not one object but a document nobody asked for, in a place its
 * author looks for their own writing.
 */
export function createFrozenDocumentCreationWriter(
  reason = 'the write freeze is on',
): DocumentCreationWriter {
  return {
    createPage: () =>
      Promise.reject(
        new ConnectorError('refused', `nothing was created: ${reason}`, {
          tool: 'doc',
          operation: 'create page',
        }),
      ),
  };
}

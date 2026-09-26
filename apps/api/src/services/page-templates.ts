import { isConnectorError, PAGE_ROLE_FOR, type PageKind } from '@prisme/connectors';
import type { z } from 'zod';
import type { pageTemplatesDto } from '../dto/create.js';
import { ApiError } from '../http/errors.js';
import type { ApiStore } from '../store/types.js';
import type { ExternalDirectory } from '../sync/directory.js';

/**
 * What each kind of page can start from (ADR-0030 rule 3).
 *
 * A page store's templates are the ones its database holds, kept and edited in
 * the document tool — so the list is read **live**, never from a cache, both for
 * the screen that proposes a choice and for the check a request with a choice
 * gets. A template added, renamed or re-marked as the default is picked up on
 * the next read, and there is nothing in prisme to re-bind.
 *
 * Read-only, and it writes nothing of prisme's either. The creation itself
 * resolves its template again in the converge pass, from the list as it stands
 * then: what is checked here is that a request names something real, not what
 * will be sent.
 */

export type PageTemplatesShape = z.infer<typeof pageTemplatesDto>;

export interface PageTemplateService {
  /** The kind's database's templates, and why there are none when there are none. */
  list(kind: PageKind): Promise<PageTemplatesShape>;
  /**
   * A requested template, checked against the kind's database's list when the
   * request is made (ADR-0030 rule 3). `undefined` in, `undefined` out: no
   * choice asks for the default, which the converge pass resolves.
   */
  check(kind: PageKind, templateId: string | undefined): Promise<string | undefined>;
}

export function createPageTemplateService(
  store: ApiStore,
  directory: ExternalDirectory,
): PageTemplateService {
  async function list(kind: PageKind): Promise<PageTemplatesShape> {
    const role = PAGE_ROLE_FOR[kind];
    const binding = (await store.bindings.list()).find((record) => record.role === role);
    if (binding === undefined) return { kind, state: 'unbound', failure: null, templates: [] };

    try {
      const templates = await directory.templates(role, binding.externalId);
      return {
        kind,
        state: templates.length === 0 ? 'no_template' : 'ready',
        failure: null,
        templates: templates.map((template) => ({
          id: template.id,
          name: template.name,
          isDefault: template.isDefault,
        })),
      };
    } catch (error) {
      // The failure kind and nothing else: the message can carry the binding.
      return {
        kind,
        state: 'unreadable',
        failure: isConnectorError(error) ? error.failure : 'unavailable',
        templates: [],
      };
    }
  }

  return {
    list,

    async check(kind, templateId) {
      if (templateId === undefined) return undefined;

      const listed = await list(kind);
      if (listed.state === 'unbound') {
        throw new ApiError(
          'unprocessable',
          `no database is bound for ${kind} pages, so there is no template to choose — bind one in Settings → Notion, or ask without choosing a template`,
        );
      }
      if (listed.state === 'unreadable') {
        throw new ApiError(
          'unprocessable',
          `the ${kind} pages database could not be read (${listed.failure ?? 'unavailable'}), so the template cannot be checked — see Settings → Notion, or ask without choosing a template`,
        );
      }
      if (!listed.templates.some((template) => template.id === templateId)) {
        // Refused rather than stored: a choice that names nothing would block
        // the page later with a reason further from the mistake (ADR-0030).
        throw new ApiError(
          'unprocessable',
          `that template is not one of the ${kind} pages database’s templates — list them with GET /page-kinds/${kind}/templates`,
        );
      }
      return templateId;
    },
  };
}

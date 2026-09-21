import { PAGE_ROLE_FOR, PAGE_TEMPLATE_FOR } from '../../role-key.js';
import type { DocToolClient } from '../../doc-tool/types.js';
import type { IdempotencyKey } from '../types.js';
import type { DocumentCreationWriter, PageDraft } from './types.js';

/**
 * The live creating writer for the document tool.
 *
 * One method, and it wraps `DocToolClient.createPage` rather than reimplementing
 * it: the token, the role bindings, the retry policy and the redacted errors
 * all live in that client, and a second path to the same endpoint would be a
 * second implementation of the same four things.
 *
 * ## What this wrapper adds, when there is so little to add
 *
 * Two things, and both are the reason the port exists rather than the pass
 * holding a client directly:
 *
 *   - **The freeze.** `createFrozenDocumentCreationWriter` is the object a
 *     deployment with `SYNC_WRITE_ENABLED=false` is handed, and having a port
 *     is what makes that possible. A client held directly can reach an API
 *     whatever the configuration says; an object that cannot is a structural
 *     freeze rather than a checked one (docs/13-migration.md §1).
 *   - **The mapping from a kind to two role keys.** `PAGE_ROLE_FOR` is
 *     prisme's decision and the pass must not make it — the draft carries a
 *     kind, and this is the one place that decides which store and which
 *     template that means.
 *
 * ## The key is not sent, and that is not an oversight
 *
 * `key` arrives because the ledger has one and the port is the same shape as
 * the task-tool's. The document tool has no idempotency key, so it is not
 * used — and the ledger's row, not the request, is what makes a retry safe:
 * `recordSatisfied` writes the external id, and the level-triggered existence
 * check inside `createPage` is what makes a second attempt return the first
 * attempt's page rather than a second one.
 */
export interface DocToolCreationWriterOptions {
  readonly client: DocToolClient;
}

export function createDocToolCreationWriter(
  options: DocToolCreationWriterOptions,
): DocumentCreationWriter {
  return {
    async createPage(draft: PageDraft, _key: IdempotencyKey) {
      const page = await options.client.createPage({
        role: PAGE_ROLE_FOR[draft.kind],
        templateRole: PAGE_TEMPLATE_FOR[draft.kind],
        title: draft.title,
      });
      return { externalId: page.externalId };
    },
  };
}

import {
  PAGE_ROLE_FOR,
  type DocToolClient,
  type PageKind,
  type RoleBindings,
} from '@prisme/connectors';
import { unreadReason } from '../unread.js';
import type { PageStore } from './types.js';

/**
 * What each kind's page store holds, read for one converge pass (ADR-0030).
 *
 * This replaces a set of "addressable kinds" computed from the bindings alone.
 * Under ADR-0025 a kind was addressable when its store *and* its template role
 * were bound, which the bindings could answer. Under ADR-0030 a kind is
 * addressable when its store is bound **and its database holds a template** —
 * a fact about the document tool rather than about prisme's own table, so it
 * has to be read, and read now: the template a page is sent with is resolved
 * from this list, not from anything recorded when the page was asked for.
 *
 * Each kind is read on its own, and a failure is kept as the kind's state
 * rather than thrown: one unshared database blocks its own pages with a reason
 * and leaves the other kinds, and the task-tool creations, to run. The failure
 * is reduced to its kind before it goes anywhere, because the message can carry
 * the binding (`../unread.ts`).
 *
 * `listTemplates` is the client's creating-path read — refused on any role that
 * does not carry `create` — so this cannot be pointed at a store prisme reads.
 */
export async function readPageStores(
  client: Pick<DocToolClient, 'listTemplates'>,
  bindings: Pick<RoleBindings, 'has'>,
  kinds: ReadonlySet<PageKind>,
): Promise<ReadonlyMap<PageKind, PageStore>> {
  const stores = new Map<PageKind, PageStore>();

  for (const kind of [...kinds].sort()) {
    const role = PAGE_ROLE_FOR[kind];
    if (!bindings.has(role)) {
      stores.set(kind, { state: 'unbound' });
      continue;
    }
    try {
      stores.set(kind, { state: 'bound', templates: await client.listTemplates(role) });
    } catch (error) {
      stores.set(kind, { state: 'unreadable', failure: unreadReason(error) });
    }
  }

  return stores;
}

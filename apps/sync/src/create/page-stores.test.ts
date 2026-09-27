import { describe, expect, it } from 'vitest';
import { ConnectorError, createRoleBindings, type RoleKey } from '@prisme/connectors';
import { readPageStores } from './page-stores.js';

/**
 * Reading what each kind's page store holds (ADR-0030), with a client that is
 * a function rather than a transport: what matters here is which kinds are
 * asked about, and what each answer becomes — not the wire, which the
 * connectors' own contract tests cover.
 */

const BRIEF = { id: 'tpl-brief', name: 'Brief', isDefault: false };

describe('reading the page stores for a pass', () => {
  it('reports a kind whose store is unbound without asking the tool about it', async () => {
    const asked: RoleKey[] = [];
    const stores = await readPageStores(
      {
        listTemplates: (role) => {
          asked.push(role);
          return Promise.resolve([BRIEF]);
        },
      },
      createRoleBindings([{ role: 'project_pages_db', externalId: 'binding-project-0001' }]),
      new Set(['initiative', 'project']),
    );

    expect(stores.get('initiative')).toEqual({ state: 'unbound' });
    expect(stores.get('project')).toEqual({ state: 'bound', templates: [BRIEF] });
    expect(asked).toEqual(['project_pages_db']);
  });

  it('keeps a bound store with no template as bound and empty — its own state', async () => {
    const stores = await readPageStores(
      { listTemplates: () => Promise.resolve([]) },
      createRoleBindings([{ role: 'capture_pages_db', externalId: 'binding-capture-0001' }]),
      new Set(['capture']),
    );

    expect(stores.get('capture')).toEqual({ state: 'bound', templates: [] });
  });

  it('keeps a failed read as the kind’s state, by failure kind only, and reads the rest', async () => {
    // One unshared database blocks its own pages and nothing else. The message
    // could carry the binding, so only the kind survives.
    const stores = await readPageStores(
      {
        listTemplates: (role) =>
          role === 'initiative_pages_db'
            ? Promise.reject(
                new ConnectorError('refused', 'binding-initiative-0001 said no', {
                  tool: 'doc',
                  operation: 'list templates',
                }),
              )
            : Promise.resolve([BRIEF]),
      },
      createRoleBindings([
        { role: 'initiative_pages_db', externalId: 'binding-initiative-0001' },
        { role: 'project_pages_db', externalId: 'binding-project-0001' },
      ]),
      new Set(['initiative', 'project']),
    );

    expect(stores.get('initiative')).toEqual({ state: 'unreadable', failure: 'refused' });
    expect(stores.get('project')).toEqual({ state: 'bound', templates: [BRIEF] });
  });
});

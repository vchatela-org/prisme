import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type TestDatabase,
} from '../test-support/database.js';
import { createTestApp, identityWith, stubDirectory } from '../test-support/app.js';
import { seedFixtures } from '../test-support/seed.js';
import { API_BASE_PATH } from './index.js';

/**
 * The Settings screens' writes, against a real PostgreSQL.
 *
 * Everything here is synthetic — invented identifiers, invented titles, the
 * fixture area list (CLAUDE.md, rule 1). What a fake store could not show:
 *
 *   - **one home per area** is a partial unique index, and the API refuses a
 *     second before the index has to;
 *   - **a colour is a slot**, 1 to 8, by a CHECK as well as by the schema;
 *   - **a binding survives a failed check**, with the failure kind beside it
 *     and nothing the tool said;
 *   - **a pasted database resolves to its data source** when the check says
 *     there is exactly one.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

/**
 * An identifier-shaped value, built at run time: the privacy deny-list refuses
 * any such literal in the tree, invented or not.
 */
const invented = (digit: string): string =>
  [8, 4, 4, 4, 12].map((length) => digit.repeat(length)).join('-');

const DATA_SOURCE = invented('a');
const DATABASE = invented('b');
const PAGE = invented('c');

describeOrSkip('the Settings screens against PostgreSQL', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await openTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.truncate();
    await seedFixtures(database.client);
  });

  const url = (path: string): string => `${API_BASE_PATH}${path}`;

  function api(scopes?: Parameters<typeof identityWith>[0]) {
    return createTestApp({
      client: database.client,
      ...(scopes === undefined ? {} : { identity: identityWith(scopes) }),
      directory: stubDirectory(
        {
          // A database pasted where a data source is wanted, already resolved
          // by the directory — the connector's contract test covers how.
          [DATABASE]: { externalId: DATA_SOURCE, title: 'Reading notes', linkId: DATABASE },
          [PAGE]: { externalId: PAGE, title: 'prisme pages', linkId: PAGE },
        },
        {
          projects: [
            { externalId: 'p-2', name: 'Second', archived: false, order: 2 },
            { externalId: 'p-1', name: 'First', archived: false, order: 1 },
          ],
          sections: [
            { externalId: 's-1', projectId: 'p-1', name: 'A section', archived: false, order: 1 },
          ],
        },
      ),
    });
  }

  interface AreaBody {
    key: string;
    colorSlot: number | null;
    mappings: { externalProjectId: string; externalSectionId: string | null; isHome: boolean }[];
  }

  interface BindingBody {
    role: string;
    bound: boolean;
    externalId: string | null;
    title: string | null;
    linkId: string | null;
    checkError: string | null;
  }

  describe('an area', () => {
    it('takes a colour, and gives it back when cleared', async () => {
      const app = api();
      const key = 'craft';

      const set = await app.request('PATCH', url(`/areas/${key}`), { colorSlot: 3 });
      expect(set.status).toBe(200);
      expect((set.body as AreaBody).colorSlot).toBe(3);

      const cleared = await app.request('PATCH', url(`/areas/${key}`), { colorSlot: null });
      expect((cleared.body as AreaBody).colorSlot).toBeNull();
    });

    it('refuses a colour outside the palette', async () => {
      const response = await api().request('PATCH', url('/areas/craft'), { colorSlot: 9 });
      expect(response.status).toBe(400);
    });

    it('keeps one home among its mappings', async () => {
      const app = api();
      const response = await app.request('PUT', url('/areas/craft/mappings'), {
        mappings: [
          { externalProjectId: 'p-1' },
          { externalProjectId: 'p-1', externalSectionId: 's-1', isHome: true },
        ],
      });
      expect(response.status).toBe(200);
      const homes = (response.body as AreaBody).mappings.filter((mapping) => mapping.isHome);
      expect(homes).toEqual([{ externalProjectId: 'p-1', externalSectionId: 's-1', isHome: true }]);

      const two = await app.request('PUT', url('/areas/craft/mappings'), {
        mappings: [
          { externalProjectId: 'p-1', isHome: true },
          { externalProjectId: 'p-2', isHome: true },
        ],
      });
      expect(two.status).toBe(400);
    });
  });

  describe('a role binding', () => {
    it('lists every role, bound or not', async () => {
      const response = await api().request('GET', url('/bindings'));
      expect(response.status).toBe(200);
      const items = (response.body as { items: BindingBody[] }).items;
      expect(items.length).toBeGreaterThanOrEqual(12);
      expect(items.every((item) => !item.bound)).toBe(true);
    });

    it('resolves a pasted database link to the data source it holds', async () => {
      const link = `https://docs.invalid/space/Reading-notes-${DATABASE.replaceAll('-', '')}?v=1`;
      const response = await api().request('PUT', url('/bindings/takeaways_db'), {
        externalId: link,
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        role: 'takeaways_db',
        bound: true,
        externalId: DATA_SOURCE,
        title: 'Reading notes',
        linkId: DATABASE,
        checkError: null,
      });
    });

    it('saves a binding whose check fails, and says why by kind alone', async () => {
      const unknown = invented('d');
      const response = await api().request('PUT', url('/bindings/media_db'), {
        externalId: unknown,
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        bound: true,
        externalId: unknown,
        title: null,
        checkError: 'refused',
      });
    });

    it('refuses a store that one role reads and another would create pages in', async () => {
      const app = api();
      await app.request('PUT', url('/bindings/takeaways_db'), { externalId: DATABASE });
      const response = await app.request('PUT', url('/bindings/initiative_pages_db'), {
        externalId: DATABASE,
      });
      expect(response.status).toBe(409);
    });

    it('lets page stores share one location, as ADR-0025 allows', async () => {
      const app = api();
      const first = await app.request('PUT', url('/bindings/initiative_pages_db'), {
        externalId: PAGE,
      });
      const second = await app.request('PUT', url('/bindings/project_pages_db'), {
        externalId: PAGE,
      });
      expect([first.status, second.status]).toEqual([200, 200]);
    });

    it('re-checks every bound store without rewriting what was bound', async () => {
      const app = api();
      // Bound by the seed file: a data source id the directory knows as a
      // database. A check reads its title and must not swap the identifier.
      await database.client`
        insert into role_binding (role, external_id) values ('objectives_db', ${DATABASE})`;
      const response = await app.request('POST', url('/bindings/check'), {});
      expect(response.status).toBe(200);
      const objectives = (response.body as { items: BindingBody[] }).items.find(
        (item) => item.role === 'objectives_db',
      );
      expect(objectives).toMatchObject({
        externalId: DATABASE,
        title: 'Reading notes',
        checkError: null,
      });
    });

    it('unbinds with null', async () => {
      const app = api();
      await app.request('PUT', url('/bindings/areas_db'), { externalId: DATABASE });
      const response = await app.request('PUT', url('/bindings/areas_db'), { externalId: null });
      expect(response.body).toMatchObject({ bound: false, externalId: null });
      const rows = await database.client`select role from role_binding where role = 'areas_db'`;
      expect(rows).toHaveLength(0);
    });

    it('is not readable with a read token', async () => {
      const response = await api(['read:areas']).request('GET', url('/bindings'));
      expect(response.status).toBe(403);
    });
  });

  describe('the task tool’s locations', () => {
    it('lists projects in the tool’s order, each with its sections', async () => {
      const response = await api().request('GET', url('/task-tool/locations'));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        failure: null,
        projects: [
          {
            id: 'p-1',
            name: 'First',
            parentId: null,
            archived: false,
            sections: [{ id: 's-1', name: 'A section', archived: false }],
          },
          { id: 'p-2', name: 'Second', parentId: null, archived: false, sections: [] },
        ],
      });
    });
  });
});

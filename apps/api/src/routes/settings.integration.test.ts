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
/** A pages database, and the data source inside it (ADR-0030). */
const PAGES_DATABASE = invented('c');
const PAGES_SOURCE = invented('e');
/** A pages database that holds no template yet. */
const EMPTY_SOURCE = invented('f');
/** A read store whose schema has no date property at all. */
const UNDATED_SOURCE = invented('9');

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
          [DATABASE]: {
            externalId: DATA_SOURCE,
            title: 'Reading notes',
            linkId: DATABASE,
            // Invented column names.
            dateProperties: ['Due', 'Period'],
            relationProperties: ['Linked notes', 'Sphere'],
          },
          [UNDATED_SOURCE]: {
            externalId: UNDATED_SOURCE,
            title: 'Loose notes',
            linkId: UNDATED_SOURCE,
            dateProperties: [],
            relationProperties: [],
          },
          [PAGES_DATABASE]: {
            externalId: PAGES_SOURCE,
            title: 'prisme pages',
            linkId: PAGES_DATABASE,
          },
          [EMPTY_SOURCE]: { externalId: EMPTY_SOURCE, title: 'Bare', linkId: EMPTY_SOURCE },
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
        {
          [PAGES_SOURCE]: [
            { id: 'tpl-brief', name: 'Brief', isDefault: true },
            { id: 'tpl-notes', name: 'Notes', isDefault: false },
          ],
          [EMPTY_SOURCE]: [],
        },
        {
          // The Life areas store's entries, when `areas_db` names the data
          // source above. Invented, non-hexadecimal page identifiers.
          [DATA_SOURCE]: [
            { externalId: 'area-page-home', title: 'Home' },
            { externalId: 'area-page-craft', title: 'Craft' },
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
    templates: { name: string; isDefault: boolean }[] | null;
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
      // Nine: six read roles and three page stores. ADR-0030 removed the three
      // template roles — a store's templates are the ones its database holds.
      expect(items).toHaveLength(9);
      expect(items.some((item) => item.role.includes('template'))).toBe(false);
      expect(items.every((item) => !item.bound)).toBe(true);
    });

    it('checks a page store as a database, and lists its templates without their ids', async () => {
      const response = await api().request('PUT', url('/bindings/initiative_pages_db'), {
        externalId: PAGES_DATABASE,
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        shape: 'data_source',
        externalId: PAGES_SOURCE,
        linkId: PAGES_DATABASE,
        checkError: null,
        templates: [
          { name: 'Brief', isDefault: true },
          { name: 'Notes', isDefault: false },
        ],
      });
      // Names for a screen; a creation resolves identifiers from the live list.
      expect(JSON.stringify(response.body)).not.toContain('tpl-');

      // And the check is kept, so the overview shows it without asking again.
      const listed = await api().request('GET', url('/bindings'));
      const kept = (listed.body as { items: BindingBody[] }).items.find(
        (item) => item.role === 'initiative_pages_db',
      );
      expect(kept?.templates).toHaveLength(2);
    });

    it('reports a page store with no template as found, holding none — not as a failure', async () => {
      // ADR-0030 rule 5: the binding is right, and the database is one template
      // away from working.
      const response = await api().request('PUT', url('/bindings/project_pages_db'), {
        externalId: EMPTY_SOURCE,
      });
      expect(response.body).toMatchObject({ checkError: null, title: 'Bare', templates: [] });
    });

    it('lists no templates for a role that is not a page store', async () => {
      const response = await api().request('PUT', url('/bindings/takeaways_db'), {
        externalId: DATABASE,
      });
      expect(response.body).toMatchObject({ checkError: null, templates: null });
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

    it('lets page stores share one database, as ADR-0025 allows', async () => {
      const app = api();
      const first = await app.request('PUT', url('/bindings/initiative_pages_db'), {
        externalId: PAGES_DATABASE,
      });
      const second = await app.request('PUT', url('/bindings/project_pages_db'), {
        externalId: PAGES_DATABASE,
      });
      expect([first.status, second.status]).toEqual([200, 200]);
    });

    it('re-checks every bound store without rewriting what was bound', async () => {
      const app = api();
      // Bound already: a data source id the directory knows as a
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

  describe('a store’s date property', () => {
    const put = (app: ReturnType<typeof api>, role: string, property: string | null) =>
      app.request('PUT', url(`/bindings/${role}/date-property`), { property });

    it('is chosen from the date properties the check found, and read back', async () => {
      const app = api();
      const bound = await app.request('PUT', url('/bindings/objectives_db'), {
        externalId: DATABASE,
      });
      expect(bound.body).toMatchObject({ dateProperty: null, dateProperties: ['Due', 'Period'] });

      const chosen = await put(app, 'objectives_db', 'Period');
      expect(chosen.status).toBe(200);
      expect(chosen.body).toMatchObject({ role: 'objectives_db', dateProperty: 'Period' });

      const listed = (await app.request('GET', url('/bindings'))).body as {
        items: { role: string; dateProperty: string | null }[];
      };
      expect(listed.items.find((item) => item.role === 'objectives_db')?.dateProperty).toBe(
        'Period',
      );
    });

    it('refuses a name that is not one of the store’s date properties', async () => {
      const app = api();
      await app.request('PUT', url('/bindings/objectives_db'), { externalId: DATABASE });
      const response = await put(app, 'objectives_db', 'Not a column');
      expect(response.status).toBe(422);
    });

    it('refuses a store that is not bound, and one prisme only creates pages in', async () => {
      const app = api();
      expect((await put(app, 'processes_db', 'Period')).status).toBe(409);

      await app.request('PUT', url('/bindings/initiative_pages_db'), {
        externalId: PAGES_DATABASE,
      });
      expect((await put(app, 'initiative_pages_db', null)).status).toBe(422);
    });

    it('survives a re-check while the store still has it, and a clear removes it', async () => {
      const app = api();
      await app.request('PUT', url('/bindings/objectives_db'), { externalId: DATABASE });
      await put(app, 'objectives_db', 'Period');

      const checked = (await app.request('POST', url('/bindings/check'), {})).body as {
        items: { role: string; dateProperty: string | null }[];
      };
      expect(checked.items.find((item) => item.role === 'objectives_db')?.dateProperty).toBe(
        'Period',
      );

      const cleared = await put(app, 'objectives_db', null);
      expect(cleared.body).toMatchObject({ dateProperty: null });
    });

    it('is dropped when the role is pointed at a store without that property', async () => {
      const app = api();
      await app.request('PUT', url('/bindings/objectives_db'), { externalId: DATABASE });
      await put(app, 'objectives_db', 'Period');

      const moved = await app.request('PUT', url('/bindings/objectives_db'), {
        externalId: UNDATED_SOURCE,
      });
      expect(moved.body).toMatchObject({ dateProperty: null, dateProperties: [] });
    });

    it('needs the settings scope', async () => {
      const response = await api(['read:adoption']).request(
        'PUT',
        url('/bindings/objectives_db/date-property'),
        { property: null },
      );
      expect(response.status).toBe(403);
    });
  });

  describe('a store’s area column (ADR-0033)', () => {
    const put = (app: ReturnType<typeof api>, role: string, property: string | null) =>
      app.request('PUT', url(`/bindings/${role}/area-property`), { property });

    it('is chosen from the relation properties the check found, and read back', async () => {
      const app = api();
      const bound = await app.request('PUT', url('/bindings/takeaways_db'), {
        externalId: DATABASE,
      });
      expect(bound.body).toMatchObject({
        areaProperty: null,
        relationProperties: ['Linked notes', 'Sphere'],
      });

      const chosen = await put(app, 'takeaways_db', 'Sphere');
      expect(chosen.status).toBe(200);
      expect(chosen.body).toMatchObject({ role: 'takeaways_db', areaProperty: 'Sphere' });

      const listed = (await app.request('GET', url('/bindings'))).body as {
        items: { role: string; areaProperty: string | null }[];
      };
      expect(listed.items.find((item) => item.role === 'takeaways_db')?.areaProperty).toBe(
        'Sphere',
      );
    });

    it('refuses a name that is not one of the store’s relation properties', async () => {
      const app = api();
      await app.request('PUT', url('/bindings/takeaways_db'), { externalId: DATABASE });
      // A date column is a column, and still not a relation.
      expect((await put(app, 'takeaways_db', 'Period')).status).toBe(422);
    });

    it('refuses a store that is not bound, and one prisme only creates pages in', async () => {
      const app = api();
      expect((await put(app, 'processes_db', 'Sphere')).status).toBe(409);

      await app.request('PUT', url('/bindings/initiative_pages_db'), {
        externalId: PAGES_DATABASE,
      });
      expect((await put(app, 'initiative_pages_db', null)).status).toBe(422);
    });

    it('survives a re-check while the store still has it, and a clear removes it', async () => {
      const app = api();
      await app.request('PUT', url('/bindings/takeaways_db'), { externalId: DATABASE });
      await put(app, 'takeaways_db', 'Sphere');

      const checked = (await app.request('POST', url('/bindings/check'), {})).body as {
        items: { role: string; areaProperty: string | null }[];
      };
      expect(checked.items.find((item) => item.role === 'takeaways_db')?.areaProperty).toBe(
        'Sphere',
      );

      const cleared = await put(app, 'takeaways_db', null);
      expect(cleared.body).toMatchObject({ areaProperty: null });
    });

    it('is dropped when the role is pointed at a store without that property', async () => {
      const app = api();
      await app.request('PUT', url('/bindings/takeaways_db'), { externalId: DATABASE });
      await put(app, 'takeaways_db', 'Sphere');

      const moved = await app.request('PUT', url('/bindings/takeaways_db'), {
        externalId: UNDATED_SOURCE,
      });
      expect(moved.body).toMatchObject({ areaProperty: null, relationProperties: [] });
    });

    it('needs the settings scope', async () => {
      const response = await api(['read:adoption']).request(
        'PUT',
        url('/bindings/takeaways_db/area-property'),
        { property: null },
      );
      expect(response.status).toBe(403);
    });
  });

  describe('an area’s own page (ADR-0033)', () => {
    interface PagedArea {
      externalPageId: string | null;
    }

    it('is set, read back, and cleared', async () => {
      const app = api();
      const set = await app.request('PATCH', url('/areas/home'), {
        externalPageId: 'area-page-home',
      });
      expect(set.status).toBe(200);
      expect((set.body as PagedArea).externalPageId).toBe('area-page-home');

      const cleared = await app.request('PATCH', url('/areas/home'), { externalPageId: null });
      expect((cleared.body as PagedArea).externalPageId).toBeNull();
    });

    it('refuses a page another area already names, however the identifier is written', async () => {
      const app = api();
      const dashed = invented('7');
      await app.request('PATCH', url('/areas/home'), { externalPageId: dashed });

      const same = await app.request('PATCH', url('/areas/craft'), { externalPageId: dashed });
      expect(same.status).toBe(409);
      const bare = await app.request('PATCH', url('/areas/craft'), {
        externalPageId: dashed.replaceAll('-', ''),
      });
      expect(bare.status).toBe(409);

      // Saving an area's own page again is not a clash with itself.
      const again = await app.request('PATCH', url('/areas/home'), { externalPageId: dashed });
      expect(again.status).toBe(200);
    });
  });

  describe('the Life areas store’s pages', () => {
    it('says so when no store is bound to it', async () => {
      const response = await api().request('GET', url('/document-tool/area-pages'));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ bound: false, failure: null, pages: [] });
    });

    it('lists the bound store’s entries by title, and which area names each', async () => {
      const app = api();
      await app.request('PUT', url('/bindings/areas_db'), { externalId: DATABASE });
      await app.request('PATCH', url('/areas/home'), { externalPageId: 'area-page-home' });
      const response = await app.request('GET', url('/document-tool/area-pages'));
      expect(response.body).toEqual({
        bound: true,
        failure: null,
        pages: [
          { id: 'area-page-craft', title: 'Craft', heldBy: null },
          { id: 'area-page-home', title: 'Home', heldBy: 'home' },
        ],
      });
    });

    it('answers with the failure kind when the store cannot be read', async () => {
      const app = api();
      await app.request('PUT', url('/bindings/areas_db'), { externalId: UNDATED_SOURCE });
      const response = await app.request('GET', url('/document-tool/area-pages'));
      expect(response.body).toEqual({ bound: true, failure: 'refused', pages: [] });
    });

    it('needs the areas scope', async () => {
      const response = await api(['read:adoption']).request(
        'GET',
        url('/document-tool/area-pages'),
      );
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

import { describe, expect, it } from 'vitest';
import { isConnectorError } from './errors.js';
import {
  assertCreatable,
  assertReadable,
  canCreate,
  createRoleBindings,
  isReadable,
  isTemplateRole,
  PAGE_ROLE_FOR,
  PAGE_TEMPLATE_FOR,
  ROLE_ACCESS,
  ROLE_KEYS,
  roleBindingsSchema,
  TEMPLATE_ROLES,
  type PageKind,
} from './role-key.js';

/**
 * Role keys are the mechanism that lets a public repository address a private
 * workspace. The tests that matter are the ones about what must *not* happen:
 * an identifier reaching an error message, and the read path reaching a store
 * prisme holds no read capability for.
 */

const SYNTHETIC_ID = 'binding-objectives-0001';

describe('role bindings', () => {
  it('resolves a bound role', () => {
    const bindings = createRoleBindings([{ role: 'objectives_db', externalId: SYNTHETIC_ID }]);
    expect(bindings.resolve('objectives_db')).toBe(SYNTHETIC_ID);
    expect(bindings.has('objectives_db')).toBe(true);
  });

  it('refuses an unbound role, and names the role rather than inventing one', () => {
    const bindings = createRoleBindings([{ role: 'objectives_db', externalId: SYNTHETIC_ID }]);
    expect(() => bindings.resolve('areas_db')).toThrow(/no binding for role areas_db/);
  });

  it('never puts an identifier in an error message', () => {
    const bindings = createRoleBindings([{ role: 'objectives_db', externalId: SYNTHETIC_ID }]);
    try {
      bindings.resolve('media_db');
      expect.unreachable('resolve should have thrown');
    } catch (error) {
      expect(isConnectorError(error)).toBe(true);
      expect((error as Error).message).not.toContain(SYNTHETIC_ID);
    }
  });

  it('refuses a role bound twice rather than picking one', () => {
    expect(() =>
      createRoleBindings([
        { role: 'objectives_db', externalId: SYNTHETIC_ID },
        { role: 'objectives_db', externalId: 'binding-objectives-0002' },
      ]),
    ).toThrow(/bound twice/);
  });

  it('lists the roles it has, and only the roles', () => {
    const bindings = createRoleBindings([
      { role: 'media_db', externalId: 'binding-media-0001' },
      { role: 'areas_db', externalId: 'binding-areas-0001' },
    ]);
    expect(bindings.bound()).toEqual(['areas_db', 'media_db']);
  });

  it('parses a binding list from configuration, and rejects an empty one', () => {
    expect(
      roleBindingsSchema.safeParse([{ role: 'areas_db', externalId: 'binding-areas-0001' }])
        .success,
    ).toBe(true);
    expect(roleBindingsSchema.safeParse([]).success).toBe(false);
    expect(roleBindingsSchema.safeParse([{ role: 'not_a_role', externalId: 'x' }]).success).toBe(
      false,
    );
    expect(roleBindingsSchema.safeParse([{ role: 'areas_db', externalId: '  ' }]).success).toBe(
      false,
    );
  });
});

describe('least privilege outbound (docs/14-threat-model.md §5)', () => {
  it('holds an access level for every role key', () => {
    expect(Object.keys(ROLE_ACCESS).sort()).toEqual([...ROLE_KEYS].sort());
  });

  it('treats reviews_db as write-only, so the read path cannot be pointed at it', () => {
    expect(isReadable('reviews_db')).toBe(false);
    expect(() => assertReadable('reviews_db', 'query reviews_db')).toThrow(/write-only/);
  });

  it('allows every readable role and refuses every other', () => {
    // Driven by the table rather than by a list spelled out again: a role added
    // with an access level nobody thought about is caught here.
    for (const role of ROLE_KEYS) {
      if (isReadable(role)) {
        expect(() => assertReadable(role, `query ${role}`)).not.toThrow();
      } else {
        expect(() => assertReadable(role, `query ${role}`)).toThrow(/may not query it/);
      }
    }
  });

  it('grants write access only where prisme owns a field', () => {
    expect(ROLE_ACCESS.objectives_db).toBe('read_write');
    expect(ROLE_ACCESS.takeaways_db).toBe('read');
    expect(ROLE_ACCESS.processes_db).toBe('read');
  });

  describe('the create capability (ADR-0025, ADR-0028)', () => {
    it('is held by the page stores and by nothing else', () => {
      expect(ROLE_KEYS.filter(canCreate)).toEqual([
        'initiative_pages_db',
        'project_pages_db',
        'capture_pages_db',
      ]);
    });

    it('is narrower than write: a creating role may not be read', () => {
      // The whole argument for the verb. If `create` implied reading, it would
      // be `write` with a nicer name — and prisme has no business reading the
      // store it adds pages to.
      for (const role of ROLE_KEYS.filter(canCreate)) {
        expect(isReadable(role)).toBe(false);
        expect(() => assertReadable(role, `query ${role}`)).toThrow(/may not query it/);
      }
    });

    it('refuses a creation against a role prisme only reads', () => {
      // The mirror of the read guard: a bug that creates under `areas_db` is a
      // bug that writes to an archive prisme was granted no capability over.
      expect(() => assertCreatable('areas_db', 'create page')).toThrow(/may not add to it/);
      expect(() => assertCreatable('reviews_db', 'create page')).toThrow(/may not add to it/);
      expect(() => assertCreatable('initiative_pages_db', 'create page')).not.toThrow();
    });

    it('addresses every page kind through its own store and its own template', () => {
      // The property ADR-0028 depends on, asserted over the vocabulary rather
      // than over the three names: a kind added without a store, or a store
      // added without a kind, is a page that cannot be created *or* one that
      // silently borrows another kind's parent. Both are compile errors already
      // — the records are `Record<PageKind, RoleKey>` — and this is what says
      // so at run time as well.
      for (const kind of Object.keys(PAGE_ROLE_FOR) as PageKind[]) {
        const store = PAGE_ROLE_FOR[kind];
        const template = PAGE_TEMPLATE_FOR[kind];
        expect(canCreate(store)).toBe(true);
        expect(isReadable(template)).toBe(true);
        expect(store).not.toBe(template);
      }

      // And the three kinds are genuinely three, not one role repeated.
      expect(new Set(Object.values(PAGE_ROLE_FOR)).size).toBe(Object.keys(PAGE_ROLE_FOR).length);
      expect(Object.keys(PAGE_ROLE_FOR).sort()).toEqual(['capture', 'initiative', 'project']);
    });

    it('reads the templates, because it copies their blocks and writes none', () => {
      for (const role of TEMPLATE_ROLES) {
        expect(isReadable(role)).toBe(true);
        expect(canCreate(role)).toBe(false);
      }
    });

    it('marks the templates as roles the adoption scan must not walk', () => {
      // A template is a page whose blocks get copied; it is neither work nor
      // adoptable, and a scan that queued it would propose adopting a document
      // nobody wrote.
      expect(TEMPLATE_ROLES.every(isTemplateRole)).toBe(true);
      expect(isTemplateRole('initiative_pages_db')).toBe(false);
    });
  });
});

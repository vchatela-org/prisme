import { describe, expect, it } from 'vitest';
import { isConnectorError } from './errors.js';
import {
  assertReadable,
  createRoleBindings,
  isReadable,
  ROLE_ACCESS,
  ROLE_KEYS,
  roleBindingsSchema,
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

  it('allows the five roles prisme reads', () => {
    for (const role of ROLE_KEYS.filter((key) => key !== 'reviews_db')) {
      expect(isReadable(role)).toBe(true);
      expect(() => assertReadable(role, `query ${role}`)).not.toThrow();
    }
  });

  it('grants write access only where prisme owns a field', () => {
    expect(ROLE_ACCESS.objectives_db).toBe('read_write');
    expect(ROLE_ACCESS.takeaways_db).toBe('read');
    expect(ROLE_ACCESS.processes_db).toBe('read');
  });
});

import { z } from 'zod';
import { ConnectorError } from './errors.js';

/**
 * External stores are addressed by **role key**, never by name or ID.
 *
 * The identifiers themselves are instance data: they load from the seed path
 * into the database (docs/15-runtime.md §2, *External bindings*) and are handed
 * to a client at construction. Nothing in this repository knows one, and this
 * module is the reason it does not have to — prisme works against any
 * workspace, which is better engineering than the privacy rule that forced it
 * (docs/17-privacy.md §1).
 */

export const ROLE_KEYS = [
  'objectives_db',
  'takeaways_db',
  'media_db',
  'areas_db',
  'processes_db',
  'reviews_db',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const roleKeySchema: z.ZodType<RoleKey> = z.enum(ROLE_KEYS);

export type RoleAccess = 'read' | 'write' | 'read_write';

/**
 * Least privilege outbound, from docs/14-threat-model.md §5.
 *
 * Read-only wherever prisme owns nothing is not a formality: it is the
 * difference between a bug corrupting a field and a bug corrupting an archive.
 * `reviews_db` is write-only — prisme pushes review summaries there and has no
 * business reading them back — so {@link assertReadable} refuses it, and the
 * read path cannot be pointed at it by mistake.
 */
export const ROLE_ACCESS: Readonly<Record<RoleKey, RoleAccess>> = {
  objectives_db: 'read_write',
  takeaways_db: 'read',
  media_db: 'read',
  areas_db: 'read',
  processes_db: 'read',
  reviews_db: 'write',
};

export function isReadable(role: RoleKey): boolean {
  return ROLE_ACCESS[role] !== 'write';
}

export interface RoleBinding {
  readonly role: RoleKey;
  /**
   * The external identifier. **Instance data**: never logged, never put in an
   * error message, never committed.
   */
  readonly externalId: string;
}

export const roleBindingSchema: z.ZodType<RoleBinding> = z.object({
  role: roleKeySchema,
  externalId: z.string().trim().min(1),
});

export const roleBindingsSchema = z.array(roleBindingSchema).min(1);

export interface RoleBindings {
  resolve(role: RoleKey): string;
  has(role: RoleKey): boolean;
  /** The roles that are bound. Keys only — never the identifiers. */
  bound(): readonly RoleKey[];
}

/**
 * Binds role keys to external identifiers.
 *
 * A duplicate binding is a configuration error rather than a last-one-wins:
 * two identifiers for one role means a run would read one store and write the
 * other, which is exactly the class of silent corruption this package exists to
 * refuse.
 */
export function createRoleBindings(bindings: readonly RoleBinding[]): RoleBindings {
  const byRole = new Map<RoleKey, string>();
  for (const binding of bindings) {
    if (byRole.has(binding.role)) {
      throw new ConnectorError('unbound_role', `role ${binding.role} is bound twice`, {
        tool: 'doc',
        operation: 'bind role keys',
      });
    }
    byRole.set(binding.role, binding.externalId);
  }

  return {
    has: (role) => byRole.has(role),
    bound: () => [...byRole.keys()].sort(),
    resolve: (role) => {
      const externalId = byRole.get(role);
      if (externalId === undefined) {
        // Names the role, never the identifier of any store that *is* bound.
        throw new ConnectorError(
          'unbound_role',
          `no binding for role ${role}; it is configured in the seed data, not in this repository`,
          { tool: 'doc', operation: 'resolve role key' },
        );
      }
      return externalId;
    },
  };
}

/** Refuses a read against a role prisme holds no read capability for. */
export function assertReadable(role: RoleKey, operation: string): void {
  if (!isReadable(role)) {
    throw new ConnectorError(
      'role_not_readable',
      `role ${role} is ${ROLE_ACCESS[role]}-only for prisme (docs/14-threat-model.md §5); the read path may not query it`,
      { tool: 'doc', operation },
    );
  }
}

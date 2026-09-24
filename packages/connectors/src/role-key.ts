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
  /*
   * ADR-0025's four, added when it was accepted.
   *
   * `ADR-0011` says an initiative's narrative page is created on demand and
   * `ADR-0019` says the same for a project, and until these existed prisme
   * could not address either target: none of the six above is where such a page
   * lives, and none is a template. So *Create page* recorded an intention
   * nothing could satisfy (W15).
   *
   * The two page stores name **where** a page is created; the two templates
   * name **what it is a copy of**. An instance that keeps both kinds of page in
   * one store binds the two to the same identifier — the distinction is
   * prisme's, and binding is instance data.
   */
  'initiative_pages_db',
  'project_pages_db',
  /*
   * ADR-0028's pair, added when it was accepted.
   *
   * ADR-0025 named an initiative's page and a project's page and stopped, on
   * purpose: a capture is neither, and guessing which of the two it meant is
   * the class of guess this repository refuses everywhere. So a capture's page
   * was recorded as an intent that the plan reported `blocked` with the reason
   * — a gap, said out loud, rather than a silent approximation.
   *
   * The gap is closed the same way the first two were: a store role and a
   * template role, bound independently, because a capture's page is not an
   * initiative's page that happens to arrive earlier.
   */
  'capture_pages_db',
  'capture_page_template',
  'initiative_page_template',
  'project_page_template',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const roleKeySchema: z.ZodType<RoleKey> = z.enum(ROLE_KEYS);

/**
 * The roles that name a **page rather than a store**, and so are read on
 * purpose rather than scanned.
 *
 * A template is a page whose blocks get copied into a new page; the adoption
 * scan walks stores looking for work somebody might want to adopt, and a
 * template is neither work nor adoptable. Kept here rather than in the scan so
 * that adding a role is a decision made in one place.
 */
export const PAGE_ROLES: readonly RoleKey[] = [
  'initiative_pages_db',
  'project_pages_db',
  'capture_pages_db',
];
export const TEMPLATE_ROLES: readonly RoleKey[] = [
  'initiative_page_template',
  'project_page_template',
  'capture_page_template',
];

export function isTemplateRole(role: RoleKey): boolean {
  return TEMPLATE_ROLES.includes(role);
}

/**
 * The kinds of narrative page prisme can address.
 *
 * Two come from ADR-0011 and ADR-0019 — an initiative's and a project's — and
 * a capture's is ADR-0028's. The third is not a convenience: a capture is a
 * task that may be promoted later, so a page created from one is a page about
 * something that is not yet an initiative, and ADR-0025 declined to guess
 * which of the two it would become.
 */
export type PageKind = 'initiative' | 'project' | 'capture';

/**
 * Which store each kind of page goes in, and which template it is a copy of.
 *
 * The *distinction* is prisme's; the *identifiers* are instance data. That is
 * ADR-0025's rule 1 in one line: an instance that keeps both kinds of page in
 * one place binds the two roles to the same identifier, and nothing here needs
 * to know that it did.
 *
 * It lives beside the vocabulary rather than in the planner because it is a
 * property of the vocabulary: a role added here without a kind, or a kind added
 * without a role, is a compile error rather than a run that blocks with a
 * reason nobody reads.
 */
export const PAGE_ROLE_FOR: Readonly<Record<PageKind, RoleKey>> = {
  initiative: 'initiative_pages_db',
  project: 'project_pages_db',
  capture: 'capture_pages_db',
};

export const PAGE_TEMPLATE_FOR: Readonly<Record<PageKind, RoleKey>> = {
  initiative: 'initiative_page_template',
  project: 'project_page_template',
  capture: 'capture_page_template',
};

export type RoleAccess = 'read' | 'write' | 'read_write' | 'create';

/**
 * Least privilege outbound, from docs/14-threat-model.md §5.
 *
 * Read-only wherever prisme owns nothing is not a formality: it is the
 * difference between a bug corrupting a field and a bug corrupting an archive.
 * `reviews_db` is write-only — prisme pushes review summaries there and has no
 * business reading them back — so {@link assertReadable} refuses it, and the
 * read path cannot be pointed at it by mistake.
 *
 * `create` is ADR-0025's verb and it is **narrower than `write`**: it permits
 * adding a page under the bound parent and permits nothing at all to content
 * that already exists. The distinction is the point — a bug in the creating
 * path adds a page, which a person deletes in a second, where a bug with
 * `write` edits a page somebody has been writing in for months. It is
 * deliberately *not* readable as well: prisme has no business reading the page
 * store, and a verb that implied both would be `write` with a nicer name.
 */
export const ROLE_ACCESS: Readonly<Record<RoleKey, RoleAccess>> = {
  objectives_db: 'read_write',
  takeaways_db: 'read',
  media_db: 'read',
  areas_db: 'read',
  processes_db: 'read',
  reviews_db: 'write',
  initiative_pages_db: 'create',
  project_pages_db: 'create',
  capture_pages_db: 'create',
  // A template is read: prisme copies its blocks and writes none of them.
  initiative_page_template: 'read',
  project_page_template: 'read',
  capture_page_template: 'read',
};

export function isReadable(role: RoleKey): boolean {
  const access = ROLE_ACCESS[role];
  return access === 'read' || access === 'read_write';
}

/** Whether prisme may add a page under this role's bound parent (ADR-0025). */
export function canCreate(role: RoleKey): boolean {
  return ROLE_ACCESS[role] === 'create';
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

/**
 * Refuses a creation against a role that does not carry the capability.
 *
 * The mirror of {@link assertReadable}, and the same argument: a bug that
 * creates under a role prisme only reads is a bug that writes to somebody's
 * archive, and the check is what makes the least-privilege table in
 * docs/14-threat-model.md §5 a boundary rather than a description.
 */
export function assertCreatable(role: RoleKey, operation: string): void {
  if (!canCreate(role)) {
    throw new ConnectorError(
      'role_not_creatable',
      `role ${role} is ${ROLE_ACCESS[role]} for prisme (docs/14-threat-model.md §5, ADR-0025); the creating path may not add to it`,
      { tool: 'doc', operation },
    );
  }
}

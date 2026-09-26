import { z } from 'zod';
import { ConnectorError } from './errors.js';

/**
 * External stores are addressed by **role key**, never by name or ID.
 *
 * The identifiers themselves are instance data: they are set in the application
 * (Settings → Notion) and stored in the database (docs/15-runtime.md §2, *External bindings*) and are handed
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
   * ADR-0025's page stores, added when it was accepted, and ADR-0030's reading
   * of them.
   *
   * `ADR-0011` says an initiative's narrative page is created on demand and
   * `ADR-0019` says the same for a project, and until these existed prisme
   * could not address either target: none of the six above is where such a page
   * lives. So *Create page* recorded an intention nothing could satisfy (W15).
   *
   * Each names **the database a kind of page is created in**, as an entry of
   * its one data source (ADR-0030 rule 1) — the `_db` suffix means what it
   * says. What a new page is a copy of is not a binding at all: it is one of the
   * templates that database holds, kept and edited in the document tool's own
   * editor. An instance that keeps two kinds of page in one database binds the
   * two roles to the same identifier — the distinction is prisme's, and binding
   * is instance data.
   */
  'initiative_pages_db',
  'project_pages_db',
  /*
   * ADR-0028's store, added when it was accepted.
   *
   * ADR-0025 named an initiative's page and a project's page and stopped, on
   * purpose: a capture is neither, and guessing which of the two it meant is
   * the class of guess this repository refuses everywhere. So a capture's page
   * was recorded as an intent that the plan reported `blocked` with the reason
   * — a gap, said out loud, rather than a silent approximation. It is closed the
   * same way the first two were, by a store of its own, because a capture's page
   * is not an initiative's page that happens to arrive earlier.
   *
   * ADR-0028 also added a template role per kind, and ADR-0030 removed all
   * three: a store's templates are the ones its database holds.
   */
  'capture_pages_db',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const roleKeySchema: z.ZodType<RoleKey> = z.enum(ROLE_KEYS);

/**
 * The roles prisme **creates in** rather than reads: the page stores.
 *
 * Kept here rather than beside each caller so that adding a role is a decision
 * made in one place. The adoption scan walks the readable stores only, so these
 * never reach it — a page store is not read as work (ADR-0030 rule 7).
 */
export const PAGE_ROLES: readonly RoleKey[] = [
  'initiative_pages_db',
  'project_pages_db',
  'capture_pages_db',
];

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
 * Which store each kind of page goes in.
 *
 * The *distinction* is prisme's; the *identifiers* are instance data. That is
 * ADR-0025's rule 1 in one line: an instance that keeps two kinds of page in one
 * database binds the two roles to the same identifier, and nothing here needs
 * to know that it did.
 *
 * There is no second record for the template. ADR-0025 had one — a template
 * role per kind — and ADR-0030 removed it: which template a page starts from is
 * read from the store's own template list when the page is created, so a
 * kind's store is the whole of what prisme needs to know about it.
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
 * adding an entry to the bound database and permits nothing at all to content
 * that already exists — including the entry it has just added. The distinction
 * is the point — a bug in the creating path adds a page, which a person deletes
 * in a second, where a bug with `write` edits a page somebody has been writing
 * in for months.
 *
 * It is deliberately *not* readable in the sense {@link assertReadable} checks:
 * no store row is ever queried as work, and no page body is read. It does carry
 * **three narrow reads**, which ADR-0030 rule 7 names because creating cannot
 * be done honestly without them: the store's schema (to find its title
 * property), its template list (to know what a page starts from), and its
 * entries' *titles* (to find the page a retry already made). Each is made by
 * the creating path itself, behind {@link assertCreatable}, and a verb that
 * implied reading anything more would be `write` with a nicer name.
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
};

/**
 * What kind of object a role names in the document tool.
 *
 * One kind, since ADR-0030: **every role names a data source.** The six read
 * roles always did, and the three page stores were parent *pages* until the
 * document tool could instantiate a database's own templates — at which point a
 * page store became the database the owner already kept (ADR-0030 rule 1).
 *
 * Kept as a type and a record rather than folded away, because the Settings
 * screen names it to a person pasting a link, and because a second shape is not
 * an edit to this file: two shapes for one role is the ambiguity ADR-0008
 * exists to prevent, one level up, and ADR-0030 rejected it by name.
 */
export type StoreShape = 'data_source';

export const ROLE_SHAPE: Readonly<Record<RoleKey, StoreShape>> = {
  objectives_db: 'data_source',
  takeaways_db: 'data_source',
  media_db: 'data_source',
  areas_db: 'data_source',
  processes_db: 'data_source',
  reviews_db: 'data_source',
  initiative_pages_db: 'data_source',
  project_pages_db: 'data_source',
  capture_pages_db: 'data_source',
};

export function isReadable(role: RoleKey): boolean {
  const access = ROLE_ACCESS[role];
  return access === 'read' || access === 'read_write';
}

/** Whether prisme may add an entry to this role's bound database (ADR-0025, ADR-0030). */
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
          `no binding for role ${role}; it is set in Settings → Notion, not in this repository`,
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

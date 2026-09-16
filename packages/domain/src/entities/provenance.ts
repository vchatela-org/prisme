import { z } from 'zod';
import { InvariantError } from './errors.js';

/**
 * Provenance — Guard 2 of the no-duplicate guarantee (docs/13-migration.md §2).
 *
 * > The planner emits a `create` action **only** for entities where
 * > `origin = 'created_in_prisme' AND external_ref IS NULL`.
 *
 * An adopted entity therefore *cannot* produce a create. That only holds while
 * `origin` is immutable, so it is immutable in three places: the type (a patch
 * cannot name it), this guard (a patch parsed from JSON is refused), and a
 * trigger in the migration (the database refuses the UPDATE outright).
 */

export type Origin = 'created_in_prisme' | 'adopted';

export const ORIGINS = ['created_in_prisme', 'adopted'] as const;

export const originSchema: z.ZodType<Origin> = z.enum(ORIGINS);

export interface HasOrigin {
  readonly id: string;
  readonly origin: Origin;
}

/**
 * Applies a patch to an entity whose `origin` is settled.
 *
 * The type already forbids naming `origin`; this also refuses it at runtime,
 * because the patch on the other side of an HTTP boundary is a parsed object
 * and the compiler was not there.
 */
export function applyPatch<T extends HasOrigin>(
  current: T,
  patch: Partial<Omit<T, 'id' | 'origin'>>,
): T {
  const incoming: Record<string, unknown> = patch;

  if ('origin' in incoming && incoming['origin'] !== current.origin) {
    throw new InvariantError(
      'origin_immutable',
      `origin is immutable after insert: ${current.id} is ${current.origin} and cannot become ${String(incoming['origin'])}`,
    );
  }
  if ('id' in incoming && incoming['id'] !== current.id) {
    throw new InvariantError(
      'origin_immutable',
      `id is immutable after insert: ${current.id} cannot become ${String(incoming['id'])}`,
    );
  }

  return { ...current, ...patch, id: current.id, origin: current.origin };
}

/** Guard 2, as a predicate. The only place a `create` may originate. */
export function mayCreateExternally(entity: HasOrigin, externalRef: string | undefined): boolean {
  return entity.origin === 'created_in_prisme' && externalRef === undefined;
}

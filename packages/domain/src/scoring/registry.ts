import { InvariantError } from '../entities/errors.js';
import type { ScoringMethod } from './types.js';

/**
 * The scoring registry (ADR-0006).
 *
 * One method is **active** — it determines ordering everywhere. Any number run
 * in **shadow**: computed and stored, never used for ordering. That is what
 * makes a method change evaluable on real data before it takes effect, instead
 * of discovering afterwards that the new ranking is worse.
 *
 * **The invariant this file exists to hold:** nothing outside `scoring/` reads a
 * method-specific field. There is no `wsjf` accessor here and there must never
 * be one — a `wsjf` column appearing anywhere is a bug, not a shortcut.
 */

export type MethodRole = 'active' | 'shadow';

export interface Registration {
  readonly method: ScoringMethod<never>;
  readonly role: MethodRole;
}

export interface Registry {
  register<Params>(method: ScoringMethod<Params>, role: MethodRole): void;
  get(id: string): ScoringMethod<never> | undefined;
  /** Throws rather than returning undefined, for callers that cannot proceed. */
  require(id: string): ScoringMethod<never>;
  /** The one method that determines ordering. Throws when none is registered. */
  activeMethod(): ScoringMethod<never>;
  listActive(): readonly ScoringMethod<never>[];
  listShadow(): readonly ScoringMethod<never>[];
  has(id: string): boolean;
  /** Test affordance. Never called by production code. */
  reset(): void;
}

export function createRegistry(): Registry {
  const registrations = new Map<string, Registration>();

  function byRole(role: MethodRole): readonly ScoringMethod<never>[] {
    // Sorted by id: iteration order of a Map is insertion order, and insertion
    // order is a fact about module loading, not about the domain
    // (packages/domain/CLAUDE.md §3).
    return [...registrations.values()]
      .filter((registration) => registration.role === role)
      .map((registration) => registration.method)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  }

  return {
    register<Params>(method: ScoringMethod<Params>, role: MethodRole): void {
      const existing = registrations.get(method.id);
      if (existing) {
        throw new InvariantError(
          'duplicate_method',
          `scoring method "${method.id}" is already registered at version ${existing.method.version}`,
        );
      }
      if (role === 'active' && byRole('active').length > 0) {
        throw new InvariantError(
          'multiple_active_methods',
          `"${method.id}" cannot be active: ordering is determined by exactly one method, and "${byRole('active')[0]?.id ?? ''}" already holds it`,
        );
      }
      registrations.set(method.id, {
        method: method as unknown as ScoringMethod<never>,
        role,
      });
    },

    get(id: string) {
      return registrations.get(id)?.method;
    },

    require(id: string) {
      const method = registrations.get(id)?.method;
      if (!method) {
        throw new InvariantError('unknown_method', `no scoring method registered as "${id}"`);
      }
      return method;
    },

    activeMethod() {
      const active = byRole('active')[0];
      if (!active) {
        throw new InvariantError(
          'no_active_method',
          'no active scoring method: ordering is undefined until one is registered',
        );
      }
      return active;
    },

    listActive: () => byRole('active'),
    listShadow: () => byRole('shadow'),
    has: (id: string) => registrations.has(id),
    reset: () => registrations.clear(),
  };
}

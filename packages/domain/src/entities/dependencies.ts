import type { Initiative, InitiativeId, InitiativeStatus } from './initiative.js';
import { CLOSED_STATUSES } from './initiative.js';
import { InvariantError } from './errors.js';

/**
 * `depends_on[]` is a DAG, and cycles are rejected **at write time, with the
 * path in the error** (W01 brief §2).
 *
 * The path matters more than the rejection. "A cycle was detected" sends
 * someone hunting through a graph by hand; "a → b → c → a" is the fix, printed.
 *
 * Deterministic throughout: every traversal walks ids in sorted order, so the
 * same graph always reports the same cycle rather than whichever one the hash
 * order happened to reach first (packages/domain/CLAUDE.md §3).
 */

export interface DependencyGraph {
  /** Initiative id → the ids it depends on, sorted. */
  readonly edges: ReadonlyMap<InitiativeId, readonly InitiativeId[]>;
  /** Ids referenced as a dependency but absent from the input set. */
  readonly danglingRefs: readonly InitiativeId[];
}

export function buildDependencyGraph(initiatives: readonly Initiative[]): DependencyGraph {
  const edges = new Map<InitiativeId, readonly InitiativeId[]>();
  const known = new Set<InitiativeId>(initiatives.map((initiative) => initiative.id));
  const dangling = new Set<InitiativeId>();

  for (const initiative of initiatives) {
    for (const dependency of initiative.dependsOn) {
      if (dependency === initiative.id) {
        throw new InvariantError('self_dependency', `${initiative.id} depends on itself`, {
          path: [initiative.id, initiative.id],
        });
      }
      if (!known.has(dependency)) dangling.add(dependency);
    }
    edges.set(initiative.id, [...initiative.dependsOn].sort());
  }

  return { edges, danglingRefs: [...dangling].sort() };
}

/**
 * The first cycle reachable from the graph, as an ordered path with the entry
 * node repeated at the end — or `undefined` when the graph is acyclic.
 */
export function findDependencyCycle(graph: DependencyGraph): readonly InitiativeId[] | undefined {
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<InitiativeId, number>();
  const stack: InitiativeId[] = [];

  const roots = [...graph.edges.keys()].sort();

  function walk(id: InitiativeId): readonly InitiativeId[] | undefined {
    const seen = state.get(id);
    if (seen === DONE) return undefined;
    if (seen === VISITING) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }

    state.set(id, VISITING);
    stack.push(id);
    for (const dependency of graph.edges.get(id) ?? []) {
      const cycle = walk(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, DONE);
    return undefined;
  }

  for (const root of roots) {
    const cycle = walk(root);
    if (cycle) return cycle;
  }
  return undefined;
}

/**
 * Builds the graph and refuses a cyclic one. This is the write-time gate: call
 * it before persisting a `depends_on` change, not after.
 */
export function assertAcyclic(initiatives: readonly Initiative[]): DependencyGraph {
  const graph = buildDependencyGraph(initiatives);
  const cycle = findDependencyCycle(graph);
  if (cycle) {
    throw new InvariantError(
      'dependency_cycle',
      `initiative dependencies must be acyclic — found ${cycle.join(' → ')}`,
      { path: cycle },
    );
  }
  return graph;
}

/**
 * The dependencies still standing in the way: those that are neither `done` nor
 * `dropped`. A dangling reference counts as blocking — an unknown dependency is
 * not an absent one, and guessing the other way silently promotes work whose
 * predecessor prisme simply has not ingested yet.
 */
export function blockedBy(
  initiative: Initiative,
  statusById: ReadonlyMap<InitiativeId, InitiativeStatus>,
): readonly InitiativeId[] {
  const blockers: InitiativeId[] = [];
  for (const dependency of initiative.dependsOn) {
    const status = statusById.get(dependency);
    if (status === undefined || !CLOSED_STATUSES.has(status)) blockers.push(dependency);
  }
  return blockers.sort();
}

export function statusIndex(
  initiatives: readonly Initiative[],
): ReadonlyMap<InitiativeId, InitiativeStatus> {
  const index = new Map<InitiativeId, InitiativeStatus>();
  for (const initiative of initiatives) index.set(initiative.id, initiative.status);
  return index;
}

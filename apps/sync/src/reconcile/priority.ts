import type { InitiativeId, InitiativeStatus, TaskPriority } from '@prisme/domain';

/**
 * The anchor priority prisme writes outward (docs/10-model.md §6):
 *
 * > top 3 `now` → highest · remaining `now` → high · `next` anchors → medium ·
 * > everything else → lowest.
 *
 * Read against **the statuses as they are**, never against the statuses
 * selection would propose. A reconciler pass applies decisions; it does not
 * make them. `selectNowSet` proposing a promotion is a suggestion for a review
 * screen, and a sync job that wrote `highest` onto an initiative nobody had
 * promoted yet would be making the decision fifteen minutes before the human
 * did.
 *
 * Rank decides which three of the `now` set are highest. Initiatives the active
 * scoring method did not rank sort after the ranked ones, by id, so the mapping
 * is total and deterministic with no score at all.
 */

export interface PrioritySubject {
  readonly id: InitiativeId;
  readonly status: InitiativeStatus;
}

const TOP_SLOTS = 3;

export function anchorPriorities(
  initiatives: readonly PrioritySubject[],
  rankedIds: readonly InitiativeId[],
): ReadonlyMap<InitiativeId, TaskPriority> {
  const rankOf = new Map<InitiativeId, number>();
  rankedIds.forEach((id, index) => {
    if (!rankOf.has(id)) rankOf.set(id, index);
  });

  const inFlight = initiatives
    .filter((initiative) => initiative.status === 'now')
    .sort((left, right) => {
      const leftRank = rankOf.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rankOf.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

  const priorities = new Map<InitiativeId, TaskPriority>();
  inFlight.forEach((initiative, index) => {
    priorities.set(initiative.id, index < TOP_SLOTS ? 'highest' : 'high');
  });

  for (const initiative of initiatives) {
    if (priorities.has(initiative.id)) continue;
    priorities.set(initiative.id, initiative.status === 'next' ? 'medium' : 'lowest');
  }

  return priorities;
}

import type { Objective } from './contracts';

/**
 * The nudges that feed the core loop — pure, and tested.
 *
 * prisme allocates, ranks and reviews, and each step needs something from a
 * person first: an initiative for the balance factor to lift, a key result for
 * the work to serve, a review for the ranking to be read back in. When one of
 * those is missing the screens stay correct and say nothing useful. These are
 * the sentences that say what is missing and where to go about it.
 *
 * Nothing here decides *whether* an area is starved: the API names the areas
 * (`starvedWithNothingQueued`, packages/domain) and this module only words them
 * (`apps/web/CLAUDE.md` non-negotiable 1).
 */

/** Where the new-initiative flow lives, and what it can be opened with. */
export const NEW_INITIATIVE_PATH = '/create/initiative';

export interface NewInitiativePreset {
  readonly areaKey?: string | undefined;
  /** The key result it will serve. Meaningless without the objective that holds it. */
  readonly keyResultId?: string | undefined;
  readonly objectiveId?: string | undefined;
}

/**
 * The new-initiative flow, opened pre-filled.
 *
 * A key result is passed with its objective, because that is what the form
 * reads to find it: there is no endpoint for one key result alone.
 */
export function newInitiativeHref(preset: NewInitiativePreset): string {
  const query = new URLSearchParams();
  if (preset.areaKey !== undefined) query.set('area', preset.areaKey);
  if (preset.keyResultId !== undefined && preset.objectiveId !== undefined) {
    query.set('objective', preset.objectiveId);
    query.set('keyResult', preset.keyResultId);
  }
  const text = query.toString();
  return text === '' ? NEW_INITIATIVE_PATH : `${NEW_INITIATIVE_PATH}?${text}`;
}

export interface Nudge {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly action: string;
}

/**
 * One notice per starved area with nothing queued, in the order the API gave.
 *
 * The factor is printed as the API computed it, to two places — the same
 * figure the score explanation quotes as *lifted ×N* — so the reader can see
 * why the area was named without opening the balance view.
 */
export function starvedAreaNudges(
  starved: readonly { readonly areaKey: string; readonly balanceFactor: number }[],
  areaName: (key: string) => string,
): readonly Nudge[] {
  return starved.map((entry) => ({
    key: entry.areaKey,
    title: `${areaName(entry.areaKey)} is starved and has nothing queued. Create an initiative for one of its key results.`,
    description: `Its balance factor is ×${entry.balanceFactor.toFixed(2)}, so anything queued there would be lifted — but nothing is, so nothing is. An initiative that serves one of its key results is what the lift can act on.`,
    href: newInitiativeHref({ areaKey: entry.areaKey }),
    action: 'Create an initiative here',
  }));
}

/**
 * A pointer to the weekly review while none has ever been closed.
 *
 * `undefined` means the API did not say, which is not the same as *never*:
 * nothing is shown rather than a pointer that may be wrong.
 */
export function firstReviewNudge(lastReviewClosedAt: string | null | undefined): Nudge | null {
  if (lastReviewClosedAt !== null) return null;
  return {
    key: 'first-review',
    title: 'No review has been closed yet',
    description:
      'The weekly review is where the ranking is read back and decided on: what moves to now, what is stale, what is dropped. Until one is closed, nothing on this screen has been through that judgement.',
    href: '/review/weekly',
    action: 'Open the weekly review',
  };
}

export interface KeyResultChoice {
  readonly id: string;
  readonly objectiveId: string;
  readonly areaKey: string;
  /** The statement, with the objective it measures, as the select shows it. */
  readonly label: string;
}

/**
 * The key results a new initiative may serve: those of **open** objectives
 * (draft or active), each labelled with its objective. A judged objective's
 * key results take no new work. The area is kept on each so the form can
 * offer only those of the area it is creating in — work serves the objectives
 * of its own area, which the API also refuses otherwise.
 */
export function keyResultChoices(objectives: readonly Objective[]): readonly KeyResultChoice[] {
  return objectives
    .filter((objective) => objective.status === 'draft' || objective.status === 'active')
    .flatMap((objective) =>
      objective.keyResults.map((keyResult) => ({
        id: keyResult.id,
        objectiveId: objective.id,
        areaKey: objective.areaKey,
        label: `${keyResult.statement} — ${objective.title} (${objective.period})`,
      })),
    );
}

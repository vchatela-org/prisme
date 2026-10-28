import type { KeyResultHint, Objective } from './contracts';

/**
 * Why an initiative looks like a key result, in a person's words
 * (docs/19-how-it-works.md S1).
 *
 * The API decides — `keyResultHints` in `@prisme/domain` — and this only words
 * the codes. Each says what was seen, never what to conclude: a hint is a
 * question for the person triaging, and an initiative can legitimately have a
 * far deadline.
 */
const HINT_TEXT: Readonly<Record<KeyResultHint, string>> = {
  long_horizon: 'its deadline is more than six weeks away',
  objective_title: 'an objective in this area has the same title',
};

export function keyResultHintText(hint: KeyResultHint): string {
  return HINT_TEXT[hint];
}

/**
 * The whole note, or nothing. One sentence, so it reads in a row as well as on
 * the initiative's page, and nothing about it is only on hover.
 */
export function keyResultHintNote(hints: readonly KeyResultHint[]): string | undefined {
  if (hints.length === 0) return undefined;
  const reasons = hints.map(keyResultHintText).join(', and ');
  return `An initiative is an outcome of one to six weeks, but ${reasons}. A goal kept as a task is usually a key result of its objective.`;
}

/** An objective a key result can be added to: draft or active. */
const OPEN_OBJECTIVE = new Set(['draft', 'active']);

/**
 * The objectives an initiative can be converted under, in the order the picker
 * offers them: its own area first — where the objective it repeats almost
 * always is — then the rest, each group newest period first.
 */
export function conversionObjectives(
  objectives: readonly Objective[],
  areaKey: string,
): readonly Objective[] {
  return objectives
    .filter((objective) => OPEN_OBJECTIVE.has(objective.status))
    .sort(
      (left, right) =>
        Number(right.areaKey === areaKey) - Number(left.areaKey === areaKey) ||
        right.period.localeCompare(left.period) ||
        left.title.localeCompare(right.title),
    );
}

import { objectivePeriodOf } from './objective.js';

/**
 * What *Adopt* may make, and why it would not — docs/13-migration.md §4.
 *
 * Adopting creates one prisme entity bound to an object that already exists,
 * and writes nothing outward (ADR-0010). The refusal rule lives here rather
 * than beside the insert because two places ask it: the write, which refuses,
 * and the queue, which says so on the row before anybody clicks. Answered in
 * one place, the screen cannot offer what the write would refuse.
 */

/**
 * The kinds a candidate can be proposed as and still be a question for the
 * queue. The rest — a loose task, a principle, a signal, the run lane — are
 * counted by the scan and left where they are.
 */
export const ADOPTABLE_KINDS = [
  'initiative',
  'project',
  'objective',
  'key_result',
  'ritual',
] as const;

export type AdoptableKind = (typeof ADOPTABLE_KINDS)[number];

export function isAdoptableKind(kind: string): kind is AdoptableKind {
  return (ADOPTABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * Why *Adopt* would refuse a candidate, as a code. The sentence is the
 * caller's to write: the API's is addressed to an API client, the screen's to
 * a person looking at the row.
 *
 * | Code | Why |
 * |---|---|
 * | `promote_takeaway` | A document-tool page proposed as an initiative is an action takeaway: it is promoted from the Inbox, not adopted (ADR-0033, amended) |
 * | `needs_objective` | A key result needs its objective and a target, and a candidate carries neither |
 * | `needs_cadence` | A ritual needs a cadence and a target, and a candidate carries neither |
 * | `not_adoptable` | The kind stays where it is and never becomes an entity |
 * | `no_area` | An entity in no area cannot be allocated to |
 * | `period_not_calendar` | An objective's dates are not exactly one calendar year or one calendar month |
 */
export const ADOPT_REFUSALS = [
  'promote_takeaway',
  'needs_objective',
  'needs_cadence',
  'not_adoptable',
  'no_area',
  'period_not_calendar',
] as const;

export type AdoptRefusal = (typeof ADOPT_REFUSALS)[number];

/** The part of a candidate the rule reads. */
export interface AdoptionSubject {
  readonly externalKind: string;
  readonly proposedKind: string;
  readonly areaKey: string | null;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
}

/**
 * Why adopting this candidate would be refused, or `undefined` if it would not.
 *
 * The kind is checked before the area: for a row no area would make adoptable,
 * "give it an area" is the wrong advice. The period is checked last, because
 * it is the one thing that is fixed in the document tool rather than here.
 *
 * The takeaway check reads the **external kind**, not the store: a page link
 * cannot anchor an initiative whichever store it came from, and a row scanned
 * before migration 0015 has no store recorded at all.
 */
export function adoptRefusal(subject: AdoptionSubject): AdoptRefusal | undefined {
  if (subject.externalKind === 'page' && subject.proposedKind === 'initiative') {
    return 'promote_takeaway';
  }
  if (subject.proposedKind === 'key_result') return 'needs_objective';
  if (subject.proposedKind === 'ritual') return 'needs_cadence';
  if (!isAdoptableKind(subject.proposedKind)) return 'not_adoptable';
  if (subject.areaKey === null) return 'no_area';
  if (
    subject.proposedKind === 'objective' &&
    objectivePeriodOf(subject.startsOn, subject.endsOn) === undefined
  ) {
    return 'period_not_calendar';
  }
  return undefined;
}

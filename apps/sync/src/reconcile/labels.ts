import { INITIATIVE_STATUSES, type InitiativeStatus } from '@prisme/domain';

/**
 * The label vocabulary — prisme's half of the task tool's labels.
 *
 * Two labels, and they do different jobs:
 *
 *   - **The anchor label** marks a task as an initiative's anchor. prisme owns
 *     it (docs/11-ownership.md §4); putting it on a task by hand is the intent
 *     channel's "make this an initiative" (docs/16-sync.md §4).
 *   - **A status-request label** asks prisme for a status change from a phone.
 *     prisme applies it and then **removes the label**, which is what makes the
 *     channel a request rather than a second source of truth.
 *
 * Every other label on a task belongs to the task tool and is carried through
 * untouched — an anchor's labels are edited by adding or removing prisme's,
 * never by replacing the list.
 */

/** Product vocabulary, not instance data. Configurable so an existing workspace can keep its own. */
export const DEFAULT_ANCHOR_LABEL = 'prisme';

/** `prisme:status:now`, `prisme:status:waiting`, … */
export const DEFAULT_STATUS_REQUEST_PREFIX = 'prisme:status:';

const STATUSES: ReadonlySet<string> = new Set(INITIATIVE_STATUSES);

export function hasLabel(labels: readonly string[], label: string): boolean {
  return labels.includes(label);
}

/** Adds prisme's label, keeping everything else and the tool's sorted order. */
export function withLabel(labels: readonly string[], label: string): readonly string[] {
  return hasLabel(labels, label) ? labels : [...labels, label].sort();
}

export function withoutLabel(labels: readonly string[], label: string): readonly string[] {
  return labels.filter((entry) => entry !== label);
}

/**
 * The status a request label asks for, or `undefined`.
 *
 * An unrecognised suffix returns `undefined` rather than a guess: a label
 * reading `prisme:status:done-ish` is a typo, and acting on a typo by picking
 * the nearest status is how a system loses a decision.
 */
export function statusRequestIn(
  labels: readonly string[],
  prefix: string,
): InitiativeStatus | undefined {
  for (const label of [...labels].sort()) {
    if (!label.startsWith(prefix)) continue;
    const requested = label.slice(prefix.length);
    if (STATUSES.has(requested)) return requested as InitiativeStatus;
  }
  return undefined;
}

/** The label carrying a status request, so it can be consumed after being honoured. */
export function statusRequestLabel(prefix: string, status: InitiativeStatus): string {
  return `${prefix}${status}`;
}

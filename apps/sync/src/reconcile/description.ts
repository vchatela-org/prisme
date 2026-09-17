import type { InitiativeId } from '@prisme/domain';

/**
 * The anchor's first line: a backlink, and the managed-fields marker.
 *
 * > A rule you can only discover by breaking it is a bad rule.
 * > — docs/16-sync.md §4, *Making ownership visible*
 *
 * The fields prisme controls are named in the tool where someone would
 * otherwise change them, at the moment they might. Everything below the first
 * line is theirs and is carried through unchanged: prisme owns *the first line*
 * of the description, not the description (docs/11-ownership.md §4).
 */

/** Named in the marker, and the exact set the planner enforces on an anchor. */
export const MANAGED_FIELDS = ['title', 'priority', 'deadline', 'label'] as const;

const MARKER = `prisme manages: ${MANAGED_FIELDS.join(', ')}`;

/**
 * The line prisme writes.
 *
 * The URL is prisme's own base URL and the initiative's id — prisme data, not
 * instance data from either tool.
 */
export function managedLine(baseUrl: string, initiativeId: InitiativeId): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/initiatives/${initiativeId} · ${MARKER}`;
}

/** Whether a line is one prisme wrote, whichever initiative it points at. */
export function isManagedLine(line: string): boolean {
  return line.includes(MARKER);
}

/**
 * The description prisme wants: its line first, then whatever was already
 * there.
 *
 * A previous prisme line is replaced rather than accumulated — otherwise every
 * change of base URL leaves a fossil at the top of someone's task.
 */
export function composeDescription(existing: string, line: string): string {
  const lines = existing.split('\n');
  const rest = lines.length > 0 && isManagedLine(lines[0] as string) ? lines.slice(1) : lines;
  // A description that was only ever prisme's line stays one line long.
  while (rest.length > 0 && (rest[0] as string).trim() === '') rest.shift();
  return rest.length === 0 ? line : `${line}\n${rest.join('\n')}`;
}

/** The part prisme compares. Everything after it is the task tool's. */
export function firstLine(text: string): string {
  return text.split('\n')[0] ?? '';
}

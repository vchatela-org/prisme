/**
 * The audit of outward writes (ADR-0031).
 *
 * Every call prisme makes that can change the document tool or the task tool
 * is recorded, whether it succeeded or not, and the record is kept for a
 * window the owner chooses on the Settings screen. This module is the
 * vocabulary and the one rule that has a number in it — how long a record is
 * kept — so that the API that displays the window and the pass that enforces it
 * cannot disagree about either.
 *
 * It is **not** the event log. `event_log` is append-only and load-bearing for
 * the KPIs, for replanning and for the rollback in docs/13-migration.md §7, so
 * nothing may ever delete from it. This record is a different thing: what was
 * *sent*, one row per call, failures included — and it is pruned by age,
 * because a record of every call grows with every pass and nobody reads last
 * year's.
 */

/** The two tools, in the vocabulary `creation_intent.tool` already uses. */
export const WRITE_AUDIT_TOOLS = ['document', 'task'] as const;
export type WriteAuditTool = (typeof WRITE_AUDIT_TOOLS)[number];

/**
 * Every outward write prisme can make — the whole write surface, one entry per
 * method on the three writer ports in `@prisme/connectors/write`. A method added
 * there without an entry here does not compile where the two meet.
 */
export const WRITE_AUDIT_OPERATIONS = [
  'create_anchor',
  'update_task',
  'move_task',
  'create_project',
  'create_section',
  'create_capture_task',
  'create_page',
] as const;
export type WriteAuditOperation = (typeof WRITE_AUDIT_OPERATIONS)[number];

/** Which half of the sync made the call: the reconciler, or the creation ledger's drain. */
export const WRITE_AUDIT_ORIGINS = ['reconciler', 'creation'] as const;
export type WriteAuditOrigin = (typeof WRITE_AUDIT_ORIGINS)[number];

export const WRITE_AUDIT_OUTCOMES = ['succeeded', 'failed'] as const;
export type WriteAuditOutcome = (typeof WRITE_AUDIT_OUTCOMES)[number];

/**
 * The retention window, in days.
 *
 * - **Default 90**: a quarter covers the weekly and monthly reviews that would
 *   look back at what prisme did, and the first-apply period in
 *   docs/13-migration.md §5 steps 8–9 with room to spare.
 * - **Floor 7**: a window shorter than the week of reviews step 9 asks for
 *   would delete the record of the first outward writes before anybody had
 *   read it. Zero is not "off"; it is "delete everything tonight".
 * - **Ceiling 3650**: ten years. The bound exists so a typo cannot become a
 *   number the database has to carry, not because a long window is wrong.
 */
export const WRITE_AUDIT_RETENTION = {
  defaultDays: 90,
  minDays: 7,
  maxDays: 3650,
} as const;

export function isRetentionDays(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= WRITE_AUDIT_RETENTION.minDays &&
    value <= WRITE_AUDIT_RETENTION.maxDays
  );
}

/**
 * The instant before which a record is pruned.
 *
 * Whole days of elapsed time, not calendar days: the pass that enforces it runs
 * at whatever hour the schedule gives it, and a record is kept for *at least*
 * the window rather than until a midnight in some time zone.
 */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

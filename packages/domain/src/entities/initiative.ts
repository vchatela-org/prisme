import { z } from 'zod';
import type { AreaKey } from './area.js';
import { type CalendarDate, calendarDateSchema } from './calendar.js';
import { type Fibonacci, fibonacciSchema } from './fibonacci.js';
import { type Origin, originSchema } from './provenance.js';

/**
 * The initiative — **the only scored unit** (ADR-0004).
 *
 * An outcome finishable in one to six weeks, phrased as a result rather than an
 * activity. An activity has no completion condition, which is how a thing stays
 * open for two years.
 *
 * `value`, `time_criticality`, `risk` and `size` never leave prisme
 * (docs/11-ownership.md §4). `deadline` is written outward to the anchor;
 * `due` is the task tool's and appears nowhere in this file — deadlines
 * prioritize, dates plan (ADR-0003).
 */

export type InitiativeId = string;

export type InitiativeStatus =
  'inbox' | 'later' | 'next' | 'now' | 'waiting' | 'review' | 'done' | 'dropped';

export const INITIATIVE_STATUSES = [
  'inbox',
  'later',
  'next',
  'now',
  'waiting',
  'review',
  'done',
  'dropped',
] as const;

/** Statuses that mean the work is off the board. Never scored, never selected. */
export const CLOSED_STATUSES: ReadonlySet<InitiativeStatus> = new Set<InitiativeStatus>([
  'done',
  'dropped',
]);

export interface Initiative {
  readonly id: InitiativeId;
  readonly title: string;
  /** **Exactly one.** A multi-area initiative breaks capacity accounting. */
  readonly areaKey: AreaKey;
  readonly projectId?: string | undefined;
  readonly status: InitiativeStatus;
  readonly value: Fibonacci;
  readonly timeCriticality: Fibonacci;
  readonly risk: Fibonacci;
  /** The size of the *next slice*. Above 8, slice it. */
  readonly size: Fibonacci;
  /** A hard external constraint. Never a plan. */
  readonly deadline?: CalendarDate | undefined;
  readonly earliestStart?: CalendarDate | undefined;
  /** Computed by the schedule engine (W02); read-only here. */
  readonly plannedStart?: CalendarDate | undefined;
  readonly plannedEnd?: CalendarDate | undefined;
  readonly dependsOn: readonly InitiativeId[];
  readonly externalPageId?: string | undefined;
  readonly externalAnchorId?: string | undefined;
  readonly origin: Origin;
  readonly doneAt?: CalendarDate | undefined;
  readonly droppedReason?: string | undefined;
}

export const initiativeSchema: z.ZodType<Initiative> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  areaKey: z.string().min(1),
  projectId: z.string().min(1).optional(),
  status: z.enum(INITIATIVE_STATUSES),
  value: fibonacciSchema,
  timeCriticality: fibonacciSchema,
  risk: fibonacciSchema,
  size: fibonacciSchema,
  deadline: calendarDateSchema.optional(),
  earliestStart: calendarDateSchema.optional(),
  plannedStart: calendarDateSchema.optional(),
  plannedEnd: calendarDateSchema.optional(),
  dependsOn: z.array(z.string().min(1)).readonly(),
  externalPageId: z.string().min(1).optional(),
  externalAnchorId: z.string().min(1).optional(),
  origin: originSchema,
  doneAt: calendarDateSchema.optional(),
  droppedReason: z.string().min(1).optional(),
});

export function isClosed(initiative: Initiative): boolean {
  return CLOSED_STATUSES.has(initiative.status);
}

/**
 * The size half of the readiness gate (docs/10-model.md, *Ready for `now`*).
 *
 * The rest of that gate — the outcome is one sentence, the first three next
 * actions are known, there is a target month — is human judgement made at a
 * review, and modelling it as a checkbox would only record that someone ticked
 * a checkbox. What is checkable in code is checked in code; the rest stays a
 * conversation.
 */
export function isSizedForNow(initiative: Initiative): boolean {
  return initiative.size <= 8;
}

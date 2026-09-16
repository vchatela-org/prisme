import { z } from 'zod';
import type { AreaKey } from './area.js';

/**
 * Review sessions and the event log — both prisme-only (docs/11-ownership.md §9).
 *
 * The event log is load-bearing three times over: KPIs and trends are
 * impossible without it, replanning needs to know what changed, and it doubles
 * as the security audit trail (docs/14-threat-model.md). It is append-only, and
 * every entry carries an actor and a before/after.
 */

export type ReviewCadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const REVIEW_CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;

export interface ReviewSession {
  readonly id: string;
  readonly cadence: ReviewCadence;
  readonly startedAt: Date;
  readonly completedAt?: Date | undefined;
  /** Checklist step id → done. The steps themselves are instance data. */
  readonly checklist: ReadonlyMap<string, boolean>;
  readonly decisions: readonly string[];
  /** Per-area KPI snapshot taken at the moment of the review. */
  readonly capacitySnapshot: ReadonlyMap<AreaKey, number>;
  readonly externalPageId?: string | undefined;
}

export type EventActor = 'human' | 'agent' | 'sync';

export const EVENT_ACTORS = ['human', 'agent', 'sync'] as const;

export type EventKind =
  | 'score_changed'
  | 'status_changed'
  | 'weight_changed'
  | 'completed'
  | 'sync_action'
  | 'adoption_decision';

export const EVENT_KINDS = [
  'score_changed',
  'status_changed',
  'weight_changed',
  'completed',
  'sync_action',
  'adoption_decision',
] as const;

export interface EventLogEntry {
  readonly id: string;
  readonly kind: EventKind;
  readonly entityKind: string;
  readonly entityId: string;
  readonly field?: string | undefined;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly actor: EventActor;
  readonly occurredAt: Date;
}

export const reviewCadenceSchema: z.ZodType<ReviewCadence> = z.enum(REVIEW_CADENCES);
export const eventKindSchema: z.ZodType<EventKind> = z.enum(EVENT_KINDS);
export const eventActorSchema: z.ZodType<EventActor> = z.enum(EVENT_ACTORS);

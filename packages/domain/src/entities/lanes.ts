import { z } from 'zod';
import type { AreaKey } from './area.js';
import type { InitiativeId } from './initiative.js';

/**
 * The lanes that are deliberately outside the ranked backlog (ADR-0014), plus
 * the reading pipeline that feeds it.
 *
 * Keeping these out of the backlog is what stops the backlog from being noise.
 * A habit task is never "done", so it either recurs forever or is closed
 * dishonestly — adherence is the measure that reflects it.
 */

export type TakeawayId = string;
export type RitualId = string;

/**
 * A takeaway is owned outright by the document tool; prisme mirrors it and
 * applies exactly one rule (docs/10-model.md §8).
 *
 * - `principle` never enters the backlog. It surfaces as context during the
 *   review of its area.
 * - `action` is a *candidate* initiative, landing in the Inbox for promotion.
 *
 * Promotion links; it does not copy the text and does not modify the takeaway.
 */
export type TakeawayKind = 'principle' | 'action';

export const TAKEAWAY_KINDS = ['principle', 'action'] as const;

export interface Takeaway {
  readonly id: TakeawayId;
  readonly kind: TakeawayKind;
  readonly externalPageId: string;
  readonly areaKey?: AreaKey | undefined;
  /** Set when this takeaway has been promoted. The takeaway itself is untouched. */
  readonly promotedTo?: InitiativeId | undefined;
}

export function mayEnterBacklog(takeaway: Takeaway): boolean {
  return takeaway.kind === 'action';
}

export type RitualCadence = 'daily' | 'weekly' | 'monthly';

export const RITUAL_CADENCES = ['daily', 'weekly', 'monthly'] as const;

export interface Ritual {
  readonly id: RitualId;
  readonly name: string;
  readonly areaKey: AreaKey;
  readonly cadence: RitualCadence;
  /** The share of opportunities you intend to take, 0–100. */
  readonly targetAdherencePct: number;
  readonly externalPageId?: string | undefined;
}

/** The metric neither external tool provides. prisme owns this series outright. */
export interface RitualAdherence {
  readonly ritualId: RitualId;
  readonly periodStart: Date;
  readonly opportunities: number;
  readonly completions: number;
}

export function adherencePct(observation: RitualAdherence): number | undefined {
  if (observation.opportunities <= 0) return undefined;
  return (observation.completions / observation.opportunities) * 100;
}

export const takeawaySchema: z.ZodType<Takeaway> = z.object({
  id: z.string().min(1),
  kind: z.enum(TAKEAWAY_KINDS),
  externalPageId: z.string().min(1),
  areaKey: z.string().min(1).optional(),
  promotedTo: z.string().min(1).optional(),
});

export const ritualSchema: z.ZodType<Ritual> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  areaKey: z.string().min(1),
  cadence: z.enum(RITUAL_CADENCES),
  targetAdherencePct: z.number().min(0).max(100),
  externalPageId: z.string().min(1).optional(),
});

import { z } from 'zod';
import { InvariantError } from './errors.js';

/**
 * External references, links, last-applied values and the conflict ledger.
 *
 * `entity_external_ref` carries Guard 1 of the no-duplicate guarantee
 * (docs/13-migration.md §2): `UNIQUE (kind, external_id)`. The database refuses
 * a second binding; no application logic is trusted with this. The index
 * builder below is the same rule in the pure layer, so a planner can find the
 * collision before it reaches a constraint violation.
 */

export type ExternalKind = 'page' | 'project' | 'section' | 'task';

export const EXTERNAL_KINDS = ['page', 'project', 'section', 'task'] as const;

export interface EntityExternalRef {
  readonly prismeId: string;
  readonly prismeKind: string;
  readonly kind: ExternalKind;
  readonly externalId: string;
}

export type MatchRule =
  'existing_mapping' | 'exact_title' | 'normalised_title' | 'fuzzy_title' | 'manual';

export type MatchConfidence = 'certain' | 'high' | 'medium' | 'low' | 'manual';

export const MATCH_RULES = [
  'existing_mapping',
  'exact_title',
  'normalised_title',
  'fuzzy_title',
  'manual',
] as const;

export const MATCH_CONFIDENCES = ['certain', 'high', 'medium', 'low', 'manual'] as const;

export interface EntityLink {
  readonly prismeId: string;
  readonly externalKind: ExternalKind;
  readonly externalId: string;
  readonly matchRule: MatchRule;
  readonly confidence: MatchConfidence;
  readonly decidedBy: 'auto' | 'human';
  readonly decidedAt: Date;
}

/**
 * Nothing below `certain` is auto-applied. An automatic fuzzy match that is
 * wrong produces exactly the corruption docs/13-migration.md exists to prevent,
 * and it does so invisibly.
 */
export function mayAutoApply(link: Pick<EntityLink, 'confidence'>): boolean {
  return link.confidence === 'certain';
}

/**
 * What prisme most recently wrote into a field it does not own
 * (docs/16-sync.md §5). Without it the only options are never propagating
 * (useless) and stomping deliberate edits (infuriating).
 */
export interface LastApplied {
  readonly entityKind: string;
  readonly entityId: string;
  readonly field: string;
  readonly value: string | null;
  readonly appliedAt: Date;
}

/**
 * The overwrite guard, in one line:
 *
 * > prisme may overwrite an externally-owned-but-prisme-propagated field only
 * > if its current value equals the value prisme last wrote.
 *
 * Never written before means never touched by prisme, so there is nothing to
 * claim — the field stays the owner's.
 */
export function mayOverwrite(currentValue: string | null, lastApplied: LastApplied | undefined) {
  if (lastApplied === undefined) return false;
  return currentValue === lastApplied.value;
}

export interface SyncConflict {
  readonly entityId: string;
  readonly field: string;
  readonly prismeValue: string | null;
  readonly externalValue: string | null;
  readonly detectedAt: Date;
  readonly resolution: 'prisme_wins' | 'external_wins' | 'unresolved';
  readonly actor: 'sync' | 'human';
}

export const externalKindSchema: z.ZodType<ExternalKind> = z.enum(EXTERNAL_KINDS);

/**
 * Guard 1 in the pure layer: an external object bound to one prisme entity
 * cannot be bound to another.
 */
export function indexExternalRefs(
  refs: readonly EntityExternalRef[],
): ReadonlyMap<string, EntityExternalRef> {
  const index = new Map<string, EntityExternalRef>();
  for (const ref of refs) {
    const compositeKey = `${ref.kind}:${ref.externalId}`;
    const existing = index.get(compositeKey);
    if (existing && existing.prismeId !== ref.prismeId) {
      throw new InvariantError(
        'duplicate_external_ref',
        `external ${ref.kind} ${ref.externalId} is already bound to ${existing.prismeId} and cannot also bind to ${ref.prismeId}`,
      );
    }
    index.set(compositeKey, ref);
  }
  return index;
}

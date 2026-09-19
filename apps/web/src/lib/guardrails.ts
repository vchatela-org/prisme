import type { Initiative, InitiativeStatus } from './contracts';

/**
 * The guardrails, and the reason none of them is a refusal.
 *
 * A hard block gets worked around — the initiative is moved somewhere else,
 * or the limit is edited, or the whole status is left wrong — and from then on
 * the model no longer describes reality. A model that lies is worse than a
 * limit that was exceeded knowingly, so every rule here **warns, explains and
 * suggests**, and the action stays available underneath it
 * (`docs/40-workstreams/W08-ui-focus.md`).
 *
 * The API agrees: `POST /initiatives/{id}/status` does not enforce a WIP limit.
 * That is deliberate on both sides, and a UI that refused here would be
 * inventing a rule the system does not have.
 *
 * Every function is pure and takes its counts as arguments. Nothing reads the
 * focus response directly, because the same warnings are shown from the
 * backlog, where the reader is looking at a row rather than a slot.
 */

export type GuardrailCode =
  'area_at_cap' | 'wip_full' | 'too_large' | 'blocked' | 'open_tasks' | 'drop_needs_reason';

export interface Guardrail {
  readonly code: GuardrailCode;
  /** One line, in the dialog's heading position. */
  readonly title: string;
  /** Why it fired, with the numbers that made it fire. */
  readonly detail: string;
  /** What to do instead. A warning with no alternative is just an obstacle. */
  readonly suggestion: string;
}

export interface WipCounts {
  /** How many initiatives are in `now` right now, across all areas. */
  readonly nowCount: number;
  readonly maxNow: number;
  /** How many are in `now` in this initiative's area. */
  readonly areaNowCount: number;
  readonly maxNowPerArea: number;
  /** The area's display name, for a sentence a reader recognises. */
  readonly areaName: string;
}

/**
 * What to warn about before moving an initiative to another status.
 *
 * Order matters: the most specific reason first, because a dialog listing four
 * warnings is read as noise while a dialog leading with "this area is full" is
 * read as an answer.
 */
export function guardrailsFor(
  initiative: Initiative,
  to: InitiativeStatus,
  counts: WipCounts | undefined,
): readonly Guardrail[] {
  const warnings: Guardrail[] = [];

  if (to === 'now' && initiative.status !== 'now') {
    if (counts !== undefined && counts.areaNowCount >= counts.maxNowPerArea) {
      warnings.push({
        code: 'area_at_cap',
        title: `${counts.areaName} is already at its cap`,
        detail: `${String(counts.areaNowCount)} of ${String(counts.maxNowPerArea)} slots in ${counts.areaName} are taken. Capacity is allocated per area before anything is ranked, so this one is not competing with the others (ADR-0005).`,
        suggestion: `Finish or park something in ${counts.areaName} first, or leave this in next and let it take the slot when one frees.`,
      });
    }

    if (counts !== undefined && counts.nowCount >= counts.maxNow) {
      warnings.push({
        code: 'wip_full',
        title: 'Every now slot is taken',
        detail: `${String(counts.nowCount)} of ${String(counts.maxNow)} initiatives are already in now.`,
        suggestion: 'Move one to next before starting this, or accept that both will move slowly.',
      });
    }

    if (!initiative.sizedForNow) {
      warnings.push({
        code: 'too_large',
        title: 'Larger than a now-sized initiative',
        detail: `Its size is ${String(initiative.size)}. Something this large has no completion condition a week can reach, which is how an initiative stays open for two years.`,
        suggestion: 'Split it into a result that can finish, and start that instead.',
      });
    }

    if (initiative.blockedBy.length > 0) {
      warnings.push({
        code: 'blocked',
        title: 'It waits on something unfinished',
        detail: `${String(initiative.blockedBy.length)} initiative${initiative.blockedBy.length === 1 ? ' it depends on is' : 's it depends on are'} neither done nor dropped.`,
        suggestion: 'Start the thing it waits on, or drop the dependency if it is no longer real.',
      });
    }
  }

  if (to === 'done' && initiative.rollup.openTaskCount > 0) {
    warnings.push({
      code: 'open_tasks',
      title: 'Open tasks remain under it',
      detail: `${String(initiative.rollup.openTaskCount)} of ${String(initiative.rollup.totalTaskCount)} mirrored tasks are still open. prisme counts that subtree and never edits it — closing this here does not close them in the task tool.`,
      suggestion: 'Close them where they live, or finish here and let the next sync mirror it.',
    });
  }

  if (to === 'dropped') {
    warnings.push({
      code: 'drop_needs_reason',
      title: 'A drop is recorded with its reason',
      detail:
        'An unexplained drop is indistinguishable from a deletion six months later, so the reason goes in the event log beside the transition.',
      suggestion:
        'Say in one line what changed. "Superseded", "no longer wanted", "done elsewhere".',
    });
  }

  return warnings;
}

/**
 * The counts for one area, from a focus response's slot lines.
 *
 * Kept beside the guardrails because the mapping is the part that is easy to
 * get subtly wrong: `used` is per area and `maxNow` is not, and a screen that
 * compares one against the other warns about the wrong thing.
 */
export function countsFrom(
  slots: readonly { areaKey: string; used: number; limit: number }[],
  areaKey: string,
  areaName: string,
  limits: { maxNow: number; maxNowPerArea: number },
  nowCount: number,
): WipCounts {
  const slot = slots.find((candidate) => candidate.areaKey === areaKey);
  return {
    nowCount,
    maxNow: limits.maxNow,
    areaNowCount: slot?.used ?? 0,
    maxNowPerArea: slot?.limit ?? limits.maxNowPerArea,
    areaName,
  };
}

import { describe, expect, it } from 'vitest';
import type { ReviewCadence, ReviewSession } from './contracts';
import { REVIEW_CADENCES } from './contracts';
import {
  artefactFor,
  CADENCE_LABELS,
  progressOf,
  stepIndexFrom,
  stepsFor,
  unknownStepIds,
  windowDaysFor,
} from './review-wizard';

/** Synthetic. No real cadence, decision or area appears in this file. */
function session(over: Partial<ReviewSession> = {}): ReviewSession {
  return {
    id: 'rev-1',
    cadence: 'weekly',
    startedAt: '2026-09-14T08:00:00.000Z',
    completedAt: null,
    checklist: {},
    decisions: [],
    capacitySnapshot: {},
    externalPageId: null,
    ...over,
  };
}

const ticked = (ids: readonly string[]): Record<string, boolean> =>
  Object.fromEntries(ids.map((id) => [id, true]));

describe('stepsFor', () => {
  it('gives every cadence a set of steps ending in recording the decisions', () => {
    for (const cadence of REVIEW_CADENCES) {
      const steps = stepsFor(cadence);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.at(-1)?.id).toBe('record-decisions');
    }
  });

  it('gives quarterly exactly the monthly set — the map adds no step shape', () => {
    expect(stepsFor('quarterly')).toEqual(stepsFor('monthly'));
  });

  it('adds one step to the yearly review, and it is the allocation', () => {
    const monthly = stepsFor('monthly').map((step) => step.id);
    const yearly = stepsFor('yearly').map((step) => step.id);

    expect(yearly.filter((id) => !monthly.includes(id))).toEqual(['allocate-weights']);
  });

  it('sends the yearly allocation to the one surface that may write a weight', () => {
    const allocate = stepsFor('yearly').find((step) => step.id === 'allocate-weights');
    expect(allocate?.surface).toBe('/review/year');
  });

  it('keeps the weekly ritual to the week’s work and the monthly one to allocation', () => {
    const weekly = stepsFor('weekly').map((step) => step.id);
    const monthly = stepsFor('monthly').map((step) => step.id);

    // The separation is the point: a monthly review that re-triages the inbox
    // is a fifth weekly review, and the allocation question is what gets
    // dropped when the time runs out.
    expect(weekly).toContain('triage-inbox');
    expect(monthly).not.toContain('triage-inbox');
    expect(monthly).toContain('capacity-declared-observed');
    expect(weekly).not.toContain('capacity-declared-observed');
  });

  it('gives every step a distinct id, so a checklist key means one thing', () => {
    for (const cadence of REVIEW_CADENCES) {
      const ids = stepsFor(cadence).map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps the conflict ledger here, because no other surface shows it', () => {
    const step = stepsFor('weekly').find((item) => item.id === 'clear-conflicts');
    expect(step?.surface).toBeNull();
  });

  it('names a label and a window for every cadence', () => {
    for (const cadence of REVIEW_CADENCES) {
      expect(CADENCE_LABELS[cadence]).toBeTruthy();
      expect(windowDaysFor(cadence)).toBeGreaterThan(0);
    }
  });

  it('widens the window as the cadence lengthens', () => {
    const windows = REVIEW_CADENCES.map((cadence: ReviewCadence) => windowDaysFor(cadence));
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index]).toBeGreaterThan(windows[index - 1] as number);
    }
  });
});

describe('progressOf', () => {
  const steps = stepsFor('weekly');

  it('starts at the first step with nothing ticked', () => {
    const progress = progressOf(steps, {});
    expect(progress.done).toBe(0);
    expect(progress.resumeIndex).toBe(0);
    expect(progress.complete).toBe(false);
  });

  it('resumes at the first gap, not at the furthest step reached', () => {
    // Ticked 1, 2 and 4. The unfinished step is 3, and landing on 5 would
    // skip it while the artefact claimed the review had covered it.
    const checklist = ticked([
      steps[0]?.id ?? '',
      steps[1]?.id ?? '',
      steps[3]?.id ?? '',
    ]);

    const progress = progressOf(steps, checklist);
    expect(progress.done).toBe(3);
    expect(progress.resumeIndex).toBe(2);
  });

  it('resumes on the last step once everything is ticked, never past the end', () => {
    const progress = progressOf(steps, ticked(steps.map((step) => step.id)));
    expect(progress.complete).toBe(true);
    expect(progress.resumeIndex).toBe(steps.length - 1);
  });

  it('treats an explicitly false tick as not done', () => {
    const progress = progressOf(steps, { [steps[0]?.id ?? '']: false });
    expect(progress.done).toBe(0);
    expect(progress.resumeIndex).toBe(0);
  });

  it('ignores a checklist key that belongs to no step', () => {
    const progress = progressOf(steps, { 'something-else': true });
    expect(progress.done).toBe(0);
    expect(progress.complete).toBe(false);
  });
});

describe('stepIndexFrom', () => {
  const steps = stepsFor('weekly');

  it('takes a valid index from the URL', () => {
    expect(stepIndexFrom('3', steps, 0)).toBe(3);
    expect(stepIndexFrom('0', steps, 5)).toBe(0);
  });

  it('falls back to the resume point on anything it cannot use', () => {
    expect(stepIndexFrom(undefined, steps, 2)).toBe(2);
    expect(stepIndexFrom('', steps, 2)).toBe(2);
    expect(stepIndexFrom('-1', steps, 2)).toBe(2);
    expect(stepIndexFrom('99', steps, 2)).toBe(2);
    expect(stepIndexFrom('two', steps, 2)).toBe(2);
    expect(stepIndexFrom('1e3', steps, 2)).toBe(2);
    expect(stepIndexFrom('01', steps, 2)).toBe(1);
  });

  it('does not overrun a very long value', () => {
    expect(stepIndexFrom('9'.repeat(400), steps, 1)).toBe(1);
  });
});

describe('unknownStepIds', () => {
  const steps = stepsFor('weekly');

  it('reports a key this build has no step for rather than dropping it', () => {
    const checklist = { ...ticked([steps[0]?.id ?? '']), 'instance-own-step': true };
    expect(unknownStepIds(steps, checklist)).toEqual(['instance-own-step']);
  });

  it('reports nothing when every key is known', () => {
    expect(unknownStepIds(steps, ticked(steps.map((step) => step.id)))).toEqual([]);
  });
});

describe('artefactFor', () => {
  const steps = stepsFor('weekly');
  const areaNames = { alpha: 'Alpha', beta: 'Beta' };

  it('records the decisions in the words they were decided in', () => {
    const artefact = artefactFor({
      session: session({ decisions: ['Carried the bench over', 'Dropped the second reading'] }),
      steps,
      areaNames,
    });

    expect(artefact).toContain('- Carried the bench over');
    expect(artefact).toContain('- Dropped the second reading');
  });

  it('says so, rather than nothing, when no decision was recorded', () => {
    const artefact = artefactFor({ session: session(), steps, areaNames });
    expect(artefact).toContain('No decision was recorded');
  });

  it('lists what was skipped, because skipped and empty read alike later', () => {
    const artefact = artefactFor({
      session: session({ checklist: ticked([steps[0]?.id ?? '']) }),
      steps,
      areaNames,
    });

    expect(artefact).toContain('## Not covered');
    expect(artefact).toContain(steps[1]?.title ?? '');
  });

  it('omits the skipped section entirely when everything was covered', () => {
    const artefact = artefactFor({
      session: session({ checklist: ticked(steps.map((step) => step.id)) }),
      steps,
      areaNames,
    });

    expect(artefact).not.toContain('## Not covered');
  });

  it('renders the capacity snapshot in words, by area name', () => {
    const artefact = artefactFor({
      session: session({ capacitySnapshot: { alpha: 42.5, beta: 10 } }),
      steps,
      areaNames,
    });

    expect(artefact).toContain('- Alpha: 42.5%');
    expect(artefact).toContain('- Beta: 10.0%');
  });

  it('falls back to the area key when no name is known for it', () => {
    const artefact = artefactFor({
      session: session({ capacitySnapshot: { gamma: 1 } }),
      steps,
      areaNames,
    });

    expect(artefact).toContain('- gamma: 1.0%');
  });

  it('omits the snapshot section for a session that was never closed', () => {
    const artefact = artefactFor({ session: session(), steps, areaNames });
    expect(artefact).not.toContain('Capacity at the moment this closed');
    expect(artefact).toContain('**Still open**');
  });

  it('dates a closed session at both ends', () => {
    const artefact = artefactFor({
      session: session({ completedAt: '2026-09-15T19:00:00.000Z' }),
      steps,
      areaNames,
    });

    expect(artefact).toContain('Opened 2026-09-14, closed 2026-09-15.');
  });

  it('titles itself by cadence', () => {
    const artefact = artefactFor({
      session: session({ cadence: 'quarterly' }),
      steps: stepsFor('quarterly'),
      areaNames,
    });

    expect(artefact.startsWith('# Quarterly review — 2026-09-14')).toBe(true);
  });
});

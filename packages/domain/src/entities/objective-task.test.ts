import { describe, expect, it } from 'vitest';
import {
  isSameTitle,
  objectiveTaskMatches,
  type ObjectiveTaskInitiative,
  type ObjectiveTaskObjective,
} from './objective-task.js';

function initiative(over: Partial<ObjectiveTaskInitiative> = {}): ObjectiveTaskInitiative {
  return {
    id: 'i-1',
    title: 'Run a half marathon',
    areaKey: 'health',
    status: 'next',
    externalAnchorId: 'task-1',
    ...over,
  };
}

function objective(over: Partial<ObjectiveTaskObjective> = {}): ObjectiveTaskObjective {
  return {
    id: 'o-1',
    title: 'Run a half marathon',
    areaKey: 'health',
    status: 'active',
    holdsTask: false,
    ...over,
  };
}

describe('an objective holds its task (ADR-0038)', () => {
  it('takes an initiative whose task carries exactly the objective’s title, in its area', () => {
    expect(objectiveTaskMatches([initiative()], [objective()])).toEqual([
      { initiativeId: 'i-1', objectiveId: 'o-1', externalTaskId: 'task-1' },
    ]);
  });

  it('ignores whitespace and Unicode form, and nothing else', () => {
    expect(isSameTitle('  Run a  half marathon ', 'Run a half marathon')).toBe(true);
    expect(isSameTitle('Café weekly', 'Café weekly')).toBe(true);
    expect(isSameTitle('run a half marathon', 'Run a half marathon')).toBe(false);
    expect(isSameTitle('Run a half marathon!', 'Run a half marathon')).toBe(false);
  });

  it('takes a draft objective too: it is open, and its window will start it', () => {
    expect(objectiveTaskMatches([initiative()], [objective({ status: 'draft' })])).toHaveLength(1);
  });

  it.each([
    ['in another area', [initiative({ areaKey: 'family' })], [objective()]],
    ['with no task', [initiative({ externalAnchorId: undefined })], [objective()]],
    ['once closed', [initiative({ status: 'dropped' })], [objective()]],
    ['for a judged objective', [initiative()], [objective({ status: 'met' })]],
    ['for an objective that holds a task', [initiative()], [objective({ holdsTask: true })]],
    [
      'when two objectives share the title',
      [initiative()],
      [objective(), objective({ id: 'o-2' })],
    ],
    [
      'when two initiatives name one objective',
      [initiative(), initiative({ id: 'i-2', externalAnchorId: 'task-2' })],
      [objective()],
    ],
  ] as const)('takes nothing %s', (_case, initiatives, objectives) => {
    expect(objectiveTaskMatches(initiatives, objectives)).toEqual([]);
  });

  it('is sorted by initiative, whatever order it reads in', () => {
    const matches = objectiveTaskMatches(
      [
        initiative({ id: 'i-9', title: 'B', externalAnchorId: 't-9' }),
        initiative({ id: 'i-1', title: 'A', externalAnchorId: 't-1' }),
      ],
      [objective({ id: 'o-a', title: 'A' }), objective({ id: 'o-b', title: 'B' })],
    );
    expect(matches.map((match) => match.initiativeId)).toEqual(['i-1', 'i-9']);
  });
});

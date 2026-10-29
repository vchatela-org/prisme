import { describe, expect, it } from 'vitest';
import type { RecurringTasks } from './contracts';
import {
  measuredFromLine,
  periodLine,
  reviewCanFulfil,
  reviewName,
  ritualTaskChoice,
  stepCompletions,
  taskTitleOf,
} from './rituals-view';

const tasks: RecurringTasks = {
  failure: null,
  items: [
    { id: 'task-budget', title: 'Budget check', areaKey: 'money', heldBy: null },
    {
      id: 'task-anchor',
      title: 'Plan the move',
      areaKey: 'health',
      heldBy: { kind: 'initiative', id: 'i-1' },
    },
    { id: 'task-walk', title: 'Walk', areaKey: 'health', heldBy: { kind: 'ritual', id: 'r-walk' } },
    {
      id: 'task-stretch',
      title: 'Stretch',
      areaKey: 'health',
      heldBy: { kind: 'ritual', id: 'r-other' },
    },
  ],
};

const names = (id: string): string | undefined =>
  id === 'r-other' ? 'Morning stretch' : undefined;

describe('the task a ritual is measured from', () => {
  it('offers its own area’s tasks first, and marks what something else holds', () => {
    const choice = ritualTaskChoice({ id: 'r-walk', areaKey: 'health' }, 'task-walk', tasks, names);
    expect(choice.state).toBe('choose');
    if (choice.state !== 'choose') return;
    expect(choice.options.map((option) => option.id)).toEqual([
      'task-anchor',
      'task-walk',
      'task-stretch',
      'task-budget',
    ]);
    expect(choice.options.map((option) => option.takenBy)).toEqual([
      'an initiative',
      // Its own task is not "taken": it is the one chosen.
      null,
      'the ritual Morning stretch',
      null,
    ]);
    expect(choice.chosen).toBe('task-walk');
    expect(choice.elsewhere).toBeNull();
  });

  it('keeps a task the tool no longer lists, by identifier', () => {
    const choice = ritualTaskChoice({ id: 'r-walk', areaKey: 'health' }, 'task-gone', tasks, names);
    expect(choice).toMatchObject({ state: 'choose', chosen: null, elsewhere: 'task-gone' });
  });

  it('marks every held task for a ritual not defined yet', () => {
    const choice = ritualTaskChoice({ areaKey: 'money' }, null, tasks, names);
    if (choice.state !== 'choose') throw new Error('expected a choice');
    expect(choice.options[0]?.id).toBe('task-budget');
    expect(choice.options.find((option) => option.id === 'task-walk')?.takenBy).toBe(
      'another ritual',
    );
  });

  it('says the tool could not be read, and keeps the task it has', () => {
    expect(
      ritualTaskChoice(
        { id: 'r-walk', areaKey: 'health' },
        'task-walk',
        { items: [], failure: 'refused' },
        names,
      ),
    ).toEqual({ state: 'unreadable', failure: 'refused', current: 'task-walk' });
    expect(ritualTaskChoice({ areaKey: 'health' }, null, null, names)).toMatchObject({
      state: 'unreadable',
    });
  });

  it('names the task when the tool listed it', () => {
    expect(taskTitleOf(tasks, 'task-walk')).toBe('Walk');
    expect(taskTitleOf(tasks, 'task-gone')).toBeNull();
    expect(taskTitleOf(null, 'task-walk')).toBeNull();
  });
});

describe('a habit recorded by hand', () => {
  it('counts days for a daily habit, and done or not for the rest', () => {
    const week = { periodStart: '2026-10-26', opportunities: 7, completions: 3 };
    expect(periodLine('daily', week)).toEqual({ label: 'This week', status: '3 of 7 days' });
    const month = { periodStart: '2026-10-01', opportunities: 1, completions: 0 };
    expect(periodLine('monthly', month)).toEqual({ label: 'This month', status: 'not yet' });
    expect(periodLine('quarterly', { ...month, completions: 1 })).toEqual({
      label: 'This quarter',
      status: 'done',
    });
  });

  it('steps within the period’s opportunities', () => {
    const week = { periodStart: '2026-10-26', opportunities: 7, completions: 7 };
    expect(stepCompletions(week, 1)).toBe(7);
    expect(stepCompletions(week, -1)).toBe(6);
    expect(stepCompletions({ ...week, completions: 0 }, -1)).toBe(0);
  });
});

describe('what a ritual is measured from, in words (S3)', () => {
  it('names the task, the review, or the hand', () => {
    expect(measuredFromLine({ cadence: 'daily', measuredFrom: 'task' }, 'Walk')).toBe(
      'Measured from “Walk” in Todoist',
    );
    expect(measuredFromLine({ cadence: 'daily', measuredFrom: 'task' }, null)).toBe(
      'Measured from a Todoist task in Todoist',
    );
    expect(measuredFromLine({ cadence: 'monthly', measuredFrom: 'review' }, null)).toBe(
      'Done each time the monthly review is closed in prisme',
    );
    expect(measuredFromLine({ cadence: 'weekly', measuredFrom: 'hand' }, null)).toBe(
      'Recorded by hand — no recurring task',
    );
  });

  it('offers the review for every cadence a review has, and never for a daily habit', () => {
    expect(reviewCanFulfil('daily')).toBe(false);
    expect(reviewCanFulfil('weekly')).toBe(true);
    expect(reviewCanFulfil('yearly')).toBe(true);
    expect(reviewName('quarterly')).toBe('the quarterly review');
  });
});

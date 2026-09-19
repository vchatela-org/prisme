import { describe, expect, it } from 'vitest';
import type { Replan, TimelineEntry } from './contracts';
import { dayOf } from './timeline-scale';
import {
  applyPreview,
  capacityBands,
  criticalIn,
  explain,
  groupRows,
  infeasibleIn,
  previewSummary,
  spanOf,
  toRows,
} from './timeline-view';

/**
 * The Timeline's decisions, without a browser.
 *
 * Fixture data throughout — invented areas, invented titles. This repository is
 * public (CLAUDE.md rule 1), and a test that reaches for a real initiative to
 * look realistic is the leak path `docs/17-privacy.md` warns about.
 */

function entry(over: Partial<TimelineEntry> & { initiativeId: string }): TimelineEntry {
  return {
    title: `Initiative ${over.initiativeId}`,
    areaKey: 'home',
    projectId: null,
    status: 'next',
    durationDays: 5,
    plannedStart: '2026-09-21',
    plannedEnd: '2026-09-25',
    earliestStart: '2026-09-21',
    earliestFinish: '2026-09-25',
    latestStart: '2026-09-21',
    latestFinish: '2026-09-25',
    slackDays: 0,
    onCriticalPath: false,
    deadline: null,
    deadlineFeasible: true,
    deadlineSlackDays: null,
    boundBy: 'none',
    boundByIds: [],
    ...over,
  };
}

const AREAS = new Map<string, { name: string; kind: 'area' | 'run' | 'signals' }>([
  ['home', { name: 'Home', kind: 'area' }],
  ['craft', { name: 'Craft', kind: 'area' }],
  ['run', { name: 'Upkeep', kind: 'run' }],
]);

describe('rows and groups', () => {
  it('draws the planned dates until a preview says otherwise', () => {
    const rows = toRows([
      entry({ initiativeId: 'a', plannedStart: '2026-10-01', plannedEnd: '2026-10-07' }),
    ]);
    expect(rows[0]?.start).toBe('2026-10-01');
    expect(rows[0]?.end).toBe('2026-10-07');
    expect(rows[0]?.moved).toBe(false);
  });

  it('orders groups by their earliest bar, not by name', () => {
    const rows = toRows([
      entry({
        initiativeId: 'later',
        areaKey: 'craft',
        plannedStart: '2026-11-02',
        plannedEnd: '2026-11-06',
      }),
      entry({
        initiativeId: 'sooner',
        areaKey: 'home',
        plannedStart: '2026-09-21',
        plannedEnd: '2026-09-25',
      }),
    ]);

    const groups = groupRows({ rows, groupBy: 'area', areas: AREAS, projects: new Map() });
    expect(groups.map((group) => group.key)).toEqual(['home', 'craft']);
    expect(groups[0]?.label).toBe('Home');
  });

  it('orders rows inside a group by start, then by id, so two renders agree', () => {
    const rows = toRows([
      entry({ initiativeId: 'b', plannedStart: '2026-09-21' }),
      entry({ initiativeId: 'a', plannedStart: '2026-09-21' }),
      entry({ initiativeId: 'c', plannedStart: '2026-09-14' }),
    ]);
    const groups = groupRows({ rows, groupBy: 'area', areas: AREAS, projects: new Map() });
    expect(groups[0]?.rows.map((row) => row.initiativeId)).toEqual(['c', 'a', 'b']);
  });

  it('groups by project, and says so when there is no project', () => {
    const rows = toRows([
      entry({ initiativeId: 'a', projectId: 'p1' }),
      entry({ initiativeId: 'b', projectId: null }),
    ]);
    const groups = groupRows({
      rows,
      groupBy: 'project',
      areas: AREAS,
      projects: new Map([['p1', 'Kitchen']]),
    });
    expect(groups.map((group) => group.label).sort()).toEqual(['Kitchen', 'No project']);
    // A project lane has no area colour of its own: the bars inside it keep
    // theirs, and a lane hue would compete with them.
    expect(groups.every((group) => group.areaKey === null)).toBe(true);
  });

  it('stretches the span to hold a deadline that falls outside the plan', () => {
    const rows = toRows([
      entry({
        initiativeId: 'a',
        plannedStart: '2026-09-21',
        plannedEnd: '2026-09-25',
        deadline: '2026-12-01',
      }),
    ]);
    // A marker drawn off the right edge is a deadline nobody sees — and the
    // one deadline worth seeing is usually the one the plan cannot reach.
    expect(spanOf(rows, { from: '2026-09-21', to: '2026-09-25' }).to).toBe('2026-12-01');
  });
});

/* ---------------------------------------------------------------------- */

const PREVIEW: Replan = {
  move: {
    initiativeId: 'a',
    requestedStart: '2026-10-05',
    actualStart: '2026-10-05',
    honoured: true,
    boundBy: 'earliest_start',
  },
  shifted: [
    {
      initiativeId: 'a',
      fromStart: '2026-09-21',
      toStart: '2026-10-05',
      fromEnd: '2026-09-25',
      toEnd: '2026-10-09',
      startDeltaDays: 10,
      endDeltaDays: 10,
      isDownstream: false,
    },
    {
      initiativeId: 'b',
      fromStart: '2026-09-28',
      toStart: '2026-10-12',
      fromEnd: '2026-10-02',
      toEnd: '2026-10-16',
      startDeltaDays: 10,
      endDeltaDays: 10,
      isDownstream: true,
    },
  ],
  brokenDeadlines: ['b'],
  repairedDeadlines: [],
  after: {
    projectEnd: '2026-10-16',
    criticalPath: ['a', 'b'],
    infeasibleDeadlines: ['b'],
    minSlackDays: -3,
  },
};

describe('the preview', () => {
  const rows = toRows([
    entry({ initiativeId: 'a', plannedStart: '2026-09-21', plannedEnd: '2026-09-25' }),
    entry({ initiativeId: 'b', plannedStart: '2026-09-28', plannedEnd: '2026-10-02' }),
    entry({ initiativeId: 'c', plannedStart: '2026-11-02', plannedEnd: '2026-11-06' }),
  ]);

  it('substitutes the API’s dates and marks what moved', () => {
    const previewed = applyPreview(rows, PREVIEW);
    const byId = new Map(previewed.map((row) => [row.initiativeId, row]));

    expect(byId.get('a')?.start).toBe('2026-10-05');
    expect(byId.get('a')?.end).toBe('2026-10-09');
    expect(byId.get('a')?.isMoveTarget).toBe(true);
    expect(byId.get('a')?.moved).toBe(true);

    // The dependent moved with it, which is the requirement the whole surface
    // exists for, and it is not the one that was dragged.
    expect(byId.get('b')?.start).toBe('2026-10-12');
    expect(byId.get('b')?.isMoveTarget).toBe(false);

    // Untouched work keeps the plan's dates exactly.
    expect(byId.get('c')?.start).toBe('2026-11-02');
    expect(byId.get('c')?.moved).toBe(false);
  });

  it('leaves the plan alone when there is no preview', () => {
    expect(applyPreview(rows, null)).toEqual(rows);
  });

  it('reads feasibility and the critical path from the preview while one is open', () => {
    const entries = [entry({ initiativeId: 'b', deadline: '2026-10-05', deadlineFeasible: true })];

    // Without a preview, the plan's own flags.
    expect([...infeasibleIn(entries, null)]).toEqual([]);
    // With one, the plan as it *would* be — telling a reader the move is safe
    // at the moment it stops being safe is the worst available answer.
    expect([...infeasibleIn(entries, PREVIEW)]).toEqual(['b']);
    expect([...criticalIn(['c'], PREVIEW)]).toEqual(['a', 'b']);
    expect([...criticalIn(['c'], null)]).toEqual(['c']);
  });

  it('summarises the move, its consequences and what it breaks', () => {
    const titles = new Map([
      ['a', 'Bench finished'],
      ['b', 'Shelves hung'],
    ]);
    const summary = previewSummary(PREVIEW, titles);

    expect(summary.honoured).toBe(true);
    expect(summary.headline).toContain('Bench finished');
    expect(summary.headline).toContain('2026-10-05');
    expect(summary.downstream).toEqual([
      'Shelves hung moves 10 working days later, to 2026-10-12.',
    ]);
    expect(summary.broken).toEqual(['Shelves hung can no longer meet its deadline.']);
    expect(summary.repaired).toEqual([]);
    expect(summary.empty).toBe(false);
  });

  it('says plainly when the plan refused the day it was dropped on', () => {
    const refused: Replan = {
      ...PREVIEW,
      move: {
        initiativeId: 'a',
        requestedStart: '2026-09-28',
        actualStart: '2026-10-05',
        honoured: false,
        boundBy: 'capacity',
      },
    };
    const summary = previewSummary(refused, new Map([['a', 'Bench finished']]));
    expect(summary.honoured).toBe(false);
    expect(summary.headline).toContain('cannot start 2026-09-28');
    expect(summary.headline).toContain('2026-10-05');
    expect(summary.headline).toContain('no free slot');
  });

  it('says nothing would change when a move lands where the plan already had it', () => {
    const nothing: Replan = { ...PREVIEW, shifted: [], brokenDeadlines: [], repairedDeadlines: [] };
    const summary = previewSummary(nothing, new Map([['a', 'Bench finished']]));
    expect(summary.empty).toBe(true);
    expect(summary.headline).toContain('Nothing would change');
  });
});

/* ---------------------------------------------------------------------- */

describe('explaining a date', () => {
  const context = {
    titleById: new Map([['dep', 'Bench finished']]),
    areaName: 'Home',
    areaSlots: 2,
    onCriticalPath: false,
  };

  it('names the dependency that set the date', () => {
    const result = explain(
      entry({ initiativeId: 'a', boundBy: 'dependency', boundByIds: ['dep'] }),
      context,
    );
    expect(result.why).toContain('Bench finished');
    expect(result.why).toContain('waits on');
  });

  it('names every dependency when several finish together', () => {
    const result = explain(
      entry({ initiativeId: 'a', boundBy: 'dependency', boundByIds: ['dep', 'other'] }),
      {
        ...context,
        titleById: new Map([
          ['dep', 'One'],
          ['other', 'Two'],
        ]),
      },
    );
    expect(result.why).toContain('One and Two');
  });

  it('says how full the area was when capacity was the constraint', () => {
    const result = explain(entry({ initiativeId: 'a', boundBy: 'capacity' }), context);
    expect(result.why).toContain('Home');
    expect(result.why).toContain('2 initiatives');
  });

  it('says a lone slot in the singular', () => {
    const result = explain(entry({ initiativeId: 'a', boundBy: 'capacity' }), {
      ...context,
      areaSlots: 1,
    });
    expect(result.why).toContain('1 initiative,');
  });

  it('answers for an unconstrained start rather than saying nothing', () => {
    expect(explain(entry({ initiativeId: 'a', boundBy: 'none' }), context).why).toContain(
      'Nothing holds it back',
    );
  });

  it('quotes the earliest start when that is what held it', () => {
    const result = explain(
      entry({ initiativeId: 'a', boundBy: 'earliest_start', earliestStart: '2026-10-01' }),
      context,
    );
    expect(result.why).toContain('2026-10-01');
  });

  it('flags an impossible deadline and never suggests moving it', () => {
    const result = explain(
      entry({
        initiativeId: 'a',
        deadline: '2026-10-01',
        deadlineFeasible: false,
        deadlineSlackDays: -4,
      }),
      context,
    );
    expect(result.deadline).toContain('misses it by 4 working days');
    expect(result.deadline).toContain('never moves a deadline');
  });

  it('has nothing to say about a deadline that does not exist', () => {
    expect(explain(entry({ initiativeId: 'a' }), context).deadline).toBeNull();
  });

  it('warns about the critical path ahead of counting slack', () => {
    const result = explain(entry({ initiativeId: 'a', slackDays: 3 }), {
      ...context,
      onCriticalPath: true,
    });
    expect(result.slack).toContain('critical path');
  });
});

/* ---------------------------------------------------------------------- */

describe('the capacity overlay', () => {
  it('bands the days where an area is running every slot it has', () => {
    const rows = toRows([
      entry({
        initiativeId: 'a',
        areaKey: 'home',
        plannedStart: '2026-09-21',
        plannedEnd: '2026-09-25',
      }),
      entry({
        initiativeId: 'b',
        areaKey: 'home',
        plannedStart: '2026-09-23',
        plannedEnd: '2026-09-28',
      }),
    ]);

    const bands = capacityBands(rows, new Map([['home', 2]]));
    expect(bands).toHaveLength(1);
    expect(bands[0]?.fromDay).toBe(dayOf('2026-09-23'));
    expect(bands[0]?.toDay).toBe(dayOf('2026-09-26'));
    expect(bands[0]?.running).toBe(2);
    expect(bands[0]?.slots).toBe(2);
  });

  it('finds nothing when an area is never full', () => {
    const rows = toRows([
      entry({
        initiativeId: 'a',
        areaKey: 'home',
        plannedStart: '2026-09-21',
        plannedEnd: '2026-09-25',
      }),
    ]);
    expect(capacityBands(rows, new Map([['home', 3]]))).toEqual([]);
  });

  it('bands an area with one slot for as long as anything is running in it', () => {
    const rows = toRows([
      entry({
        initiativeId: 'a',
        areaKey: 'craft',
        plannedStart: '2026-09-21',
        plannedEnd: '2026-09-23',
      }),
      entry({
        initiativeId: 'b',
        areaKey: 'craft',
        plannedStart: '2026-09-28',
        plannedEnd: '2026-09-30',
      }),
    ]);
    // Two bands, not one: the gap between them is capacity the area had free,
    // and painting over it would say the opposite of what happened.
    const bands = capacityBands(rows, new Map([['craft', 1]]));
    expect(bands).toHaveLength(2);
    expect(bands[0]?.toDay).toBe(dayOf('2026-09-24'));
    expect(bands[1]?.fromDay).toBe(dayOf('2026-09-28'));
  });

  it('ignores an area the plan reports no slot count for', () => {
    const rows = toRows([entry({ initiativeId: 'a', areaKey: 'unknown' })]);
    expect(capacityBands(rows, new Map())).toEqual([]);
  });

  it('is deterministic: the same rows in any order give the same bands', () => {
    const rows = toRows([
      entry({
        initiativeId: 'a',
        areaKey: 'home',
        plannedStart: '2026-09-21',
        plannedEnd: '2026-09-25',
      }),
      entry({
        initiativeId: 'b',
        areaKey: 'home',
        plannedStart: '2026-09-23',
        plannedEnd: '2026-09-28',
      }),
      entry({
        initiativeId: 'c',
        areaKey: 'craft',
        plannedStart: '2026-09-21',
        plannedEnd: '2026-09-25',
      }),
    ]);
    const forwards = capacityBands(
      rows,
      new Map([
        ['home', 2],
        ['craft', 1],
      ]),
    );
    const backwards = capacityBands(
      [...rows].reverse(),
      new Map([
        ['home', 2],
        ['craft', 1],
      ]),
    );
    expect(backwards).toEqual(forwards);
  });
});

import { describe, expect, it } from 'vitest';
import type { KeyResult } from './contracts';
import {
  firstReviewNudge,
  keyResultChoices,
  newInitiativeHref,
  NEW_INITIATIVE_PATH,
  starvedAreaNudges,
} from './nudge-view';
import { anObjective } from './test-fixtures';

function aKeyResult(overrides: Partial<KeyResult> = {}): KeyResult {
  return {
    id: 'kr-0001',
    objectiveId: 'objective-0001',
    statement: 'Long run distance',
    target: 21,
    unit: 'km',
    progressSelf: 0,
    progressComputed: null,
    externalAnchorId: null,
    servedBy: [],
    measurementCount: 0,
    createdAt: '2026-01-02T09:00:00.000Z',
    ...overrides,
  };
}

describe('newInitiativeHref', () => {
  it('is the bare flow with nothing preset', () => {
    expect(newInitiativeHref({})).toBe(NEW_INITIATIVE_PATH);
  });

  it('carries the area', () => {
    expect(newInitiativeHref({ areaKey: 'health' })).toBe('/create/initiative?area=health');
  });

  it('carries a key result only with its objective', () => {
    expect(newInitiativeHref({ areaKey: 'health', objectiveId: 'o-1', keyResultId: 'kr-1' })).toBe(
      '/create/initiative?area=health&objective=o-1&keyResult=kr-1',
    );
    expect(newInitiativeHref({ areaKey: 'health', keyResultId: 'kr-1' })).toBe(
      '/create/initiative?area=health',
    );
  });

  it('escapes what it carries', () => {
    expect(newInitiativeHref({ areaKey: 'a&b' })).toBe('/create/initiative?area=a%26b');
  });
});

describe('starvedAreaNudges', () => {
  it('names the area, quotes the factor and links the flow pre-filled', () => {
    const [nudge] = starvedAreaNudges([{ areaKey: 'health', balanceFactor: 2 }], () => 'Health');
    expect(nudge).toMatchObject({
      key: 'health',
      title:
        'Health is starved and has nothing queued. Create an initiative for one of its key results.',
      href: '/create/initiative?area=health',
    });
    expect(nudge?.description).toContain('×2.00');
  });

  it('says nothing when no area is named', () => {
    expect(starvedAreaNudges([], (key) => key)).toEqual([]);
  });

  it('keeps the order the API gave', () => {
    expect(
      starvedAreaNudges(
        [
          { areaKey: 'craft', balanceFactor: 1.5 },
          { areaKey: 'health', balanceFactor: 2 },
        ],
        (key) => key,
      ).map((nudge) => nudge.key),
    ).toEqual(['craft', 'health']);
  });
});

describe('firstReviewNudge', () => {
  it('points at the weekly review while none has been closed', () => {
    expect(firstReviewNudge(null)).toMatchObject({ href: '/review/weekly' });
  });

  it('is silent once one has', () => {
    expect(firstReviewNudge('2026-09-14T18:00:00.000Z')).toBeNull();
  });

  it('is silent when the API did not say', () => {
    expect(firstReviewNudge(undefined)).toBeNull();
  });
});

describe('keyResultChoices', () => {
  it('offers the key results of open objectives, labelled with their objective', () => {
    const choices = keyResultChoices([
      anObjective({ id: 'o-active', keyResults: [aKeyResult({ id: 'kr-a' })] }),
      anObjective({
        id: 'o-draft',
        status: 'draft',
        areaKey: 'craft',
        keyResults: [aKeyResult({ id: 'kr-d', statement: 'Pieces finished' })],
      }),
      anObjective({ id: 'o-met', status: 'met', keyResults: [aKeyResult({ id: 'kr-m' })] }),
      anObjective({ id: 'o-missed', status: 'missed', keyResults: [aKeyResult({ id: 'kr-x' })] }),
    ]);
    expect(choices.map((choice) => choice.id)).toEqual(['kr-a', 'kr-d']);
    expect(choices[0]).toEqual({
      id: 'kr-a',
      objectiveId: 'o-active',
      areaKey: 'health',
      label: 'Long run distance — Run a half marathon (2026)',
    });
    expect(choices[1]?.areaKey).toBe('craft');
  });
});

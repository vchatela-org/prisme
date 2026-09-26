import { describe, expect, it } from 'vitest';
import { homeLocation, type AreaMappingShape } from './area.js';

function at(
  externalProjectId: string,
  externalSectionId: string | null = null,
  isHome = false,
): AreaMappingShape {
  return { areaKey: 'craft', externalProjectId, externalSectionId, isHome };
}

describe('where new work for an area is created', () => {
  it('is nowhere for an area mapped nowhere', () => {
    expect(homeLocation('craft', [{ ...at('p-1'), areaKey: 'other' }])).toBeUndefined();
  });

  it('is the home when one is marked, even over a more specific mapping', () => {
    expect(homeLocation('craft', [at('p-1', 's-1'), at('p-2', null, true)])).toEqual(
      at('p-2', null, true),
    );
  });

  it('is the most specific mapping when none is marked', () => {
    expect(homeLocation('craft', [at('p-1'), at('p-2', 's-1')])).toEqual(at('p-2', 's-1'));
  });

  it('breaks a tie the same way whatever order the rows arrive in', () => {
    const rows = [at('p-9'), at('p-1'), at('p-5')];
    expect(homeLocation('craft', rows)).toEqual(at('p-1'));
    expect(homeLocation('craft', [...rows].reverse())).toEqual(at('p-1'));
  });

  it('treats an absent section and a null one as the same fact', () => {
    const fromDomain = { areaKey: 'craft', externalProjectId: 'p-1' };
    expect(homeLocation('craft', [fromDomain, at('p-0')])).toEqual(at('p-0'));
  });
});

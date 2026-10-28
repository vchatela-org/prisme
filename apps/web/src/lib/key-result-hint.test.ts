import { describe, expect, it } from 'vitest';
import { KEY_RESULT_HINTS } from './contracts';
import { conversionObjectives, keyResultHintNote, keyResultHintText } from './key-result-hint';
import { anObjective } from './test-fixtures';

describe('the key-result hint, in words', () => {
  it('words every hint the API can send', () => {
    for (const hint of KEY_RESULT_HINTS) {
      expect(keyResultHintText(hint).length).toBeGreaterThan(0);
    }
  });

  it('says nothing for an initiative with no hint', () => {
    expect(keyResultHintNote([])).toBeUndefined();
  });

  it('names each sign that was seen, in the order the API sent them', () => {
    const note = keyResultHintNote(['long_horizon', 'objective_title']);
    expect(note).toContain('more than six weeks away, and an objective in this area');
    expect(note).toContain('key result of its objective');
  });
});

describe('the objectives a conversion is offered', () => {
  it('is open objectives only, its own area first, newest period first', () => {
    const offered = conversionObjectives(
      [
        anObjective({ id: 'o-1', title: 'Elsewhere', areaKey: 'home', period: '2026' }),
        anObjective({ id: 'o-2', title: 'Older', areaKey: 'health', period: '2025' }),
        anObjective({ id: 'o-3', title: 'Met', areaKey: 'health', status: 'met' }),
        anObjective({ id: 'o-4', title: 'Current', areaKey: 'health', period: '2026' }),
        anObjective({
          id: 'o-5',
          title: 'Next month',
          areaKey: 'health',
          status: 'draft',
          period: '2026-11',
        }),
      ],
      'health',
    );
    expect(offered.map((objective) => objective.id)).toEqual(['o-5', 'o-4', 'o-2', 'o-1']);
  });
});

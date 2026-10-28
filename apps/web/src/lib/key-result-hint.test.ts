import { describe, expect, it } from 'vitest';
import { KEY_RESULT_HINTS } from './contracts';
import { keyResultHintNote, keyResultHintText } from './key-result-hint';

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

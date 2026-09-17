import { describe, expect, it } from 'vitest';
import { INITIATIVE_STATUSES } from '@prisme/domain';
import { anchorPriorities } from './priority.js';

/**
 * docs/10-model.md §6: top 3 `now` → highest, rest of `now` → high, `next` →
 * medium, everything else → lowest.
 */

describe('the priority prisme writes outward', () => {
  it('gives the top three of the now set the highest priority, in rank order', () => {
    const priorities = anchorPriorities(
      [
        { id: 'init-005', status: 'now' },
        { id: 'init-004', status: 'now' },
        { id: 'init-003', status: 'now' },
        { id: 'init-002', status: 'now' },
      ],
      ['init-002', 'init-003', 'init-004', 'init-005'],
    );

    expect(priorities.get('init-002')).toBe('highest');
    expect(priorities.get('init-003')).toBe('highest');
    expect(priorities.get('init-004')).toBe('highest');
    expect(priorities.get('init-005')).toBe('high');
  });

  it('is total: every status maps to something, with no ranking at all', () => {
    const priorities = anchorPriorities(
      INITIATIVE_STATUSES.map((status) => ({ id: `init-${status}`, status })),
      [],
    );

    expect(priorities.size).toBe(INITIATIVE_STATUSES.length);
    expect(priorities.get('init-now')).toBe('highest');
    expect(priorities.get('init-next')).toBe('medium');
    expect(priorities.get('init-later')).toBe('lowest');
    expect(priorities.get('init-done')).toBe('lowest');
  });

  it('breaks a tie by id, so two runs over unranked work agree', () => {
    const subjects = [
      { id: 'init-b', status: 'now' as const },
      { id: 'init-a', status: 'now' as const },
      { id: 'init-c', status: 'now' as const },
      { id: 'init-d', status: 'now' as const },
    ];

    expect(anchorPriorities(subjects, []).get('init-d')).toBe('high');
    expect(anchorPriorities([...subjects].reverse(), []).get('init-d')).toBe('high');
  });

  it('reads the statuses as they are, not as selection would propose them', () => {
    // `init-002` outranks everything and is still only `later`: a sync pass
    // does not promote it, and must not write it a `now` priority.
    const priorities = anchorPriorities(
      [
        { id: 'init-001', status: 'now' },
        { id: 'init-002', status: 'later' },
      ],
      ['init-002', 'init-001'],
    );

    expect(priorities.get('init-002')).toBe('lowest');
    expect(priorities.get('init-001')).toBe('highest');
  });
});

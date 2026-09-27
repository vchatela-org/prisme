import { describe, expect, it } from 'vitest';
import { durationLabel, requestFields, writeSummary } from './audit-view';

describe('the audit view', () => {
  it('names a call by the title, content or name it sent', () => {
    const sent = (request: Record<string, unknown>) =>
      writeSummary({ request, entityTitle: 'The entity now' });
    expect(sent({ content: 'Replace the fence', priority: 'high' })).toEqual({
      text: 'Replace the fence',
      sent: true,
    });
    expect(sent({ kind: 'initiative', title: 'Garden plan' })?.text).toBe('Garden plan');
    expect(sent({ name: 'Kitchen', parentId: 'p-1' })?.text).toBe('Kitchen');
  });

  it('falls back to the entity’s title now for a call that sent none, and says so', () => {
    expect(
      writeSummary({ request: { priority: 'highest' }, entityTitle: 'Replace the fence' }),
    ).toEqual({ text: 'Replace the fence', sent: false });
  });

  it('has no summary when the call sent no name and names no entity', () => {
    expect(writeSummary({ request: { projectId: 'p-2' }, entityTitle: null })).toBeNull();
    expect(writeSummary({ request: { content: '  ' }, entityTitle: ' ' })).toBeNull();
  });

  it('lists what was sent, and says a null cleared the field', () => {
    expect(
      requestFields({
        request: { priority: 'highest', deadline: null, labels: ['prisme', 'home'] },
      }),
    ).toEqual([
      { label: 'Priority', value: 'highest' },
      { label: 'Deadline', value: 'cleared' },
      { label: 'Labels', value: 'prisme, home' },
    ]);
  });

  it('keeps a field it has no label for under its own name', () => {
    expect(requestFields({ request: { somethingNew: 3 } })).toEqual([
      { label: 'somethingNew', value: '3' },
    ]);
  });

  it('reads a duration at a glance', () => {
    expect(durationLabel(340)).toBe('340 ms');
    expect(durationLabel(1240)).toBe('1.2 s');
  });
});

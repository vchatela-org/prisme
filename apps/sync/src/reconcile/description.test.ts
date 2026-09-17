import { describe, expect, it } from 'vitest';
import { composeDescription, firstLine, isManagedLine, managedLine } from './description.js';
import {
  DEFAULT_ANCHOR_LABEL,
  DEFAULT_STATUS_REQUEST_PREFIX,
  statusRequestIn,
  withLabel,
  withoutLabel,
} from './labels.js';

describe('the managed-fields marker', () => {
  it('names the fields prisme controls, where someone would otherwise change them', () => {
    const line = managedLine('https://prisme.example', 'init-001');

    expect(line).toContain('https://prisme.example/initiatives/init-001');
    expect(line).toContain('title, priority, deadline, label');
    expect(isManagedLine(line)).toBe(true);
  });

  it('does not double the slash when the base URL already ends in one', () => {
    expect(managedLine('https://prisme.example/', 'init-001')).toContain('example/initiatives/');
  });
});

describe('composing a description', () => {
  it('puts prisme’s line first and leaves everything below it alone', () => {
    const composed = composeDescription(
      'my notes\nand more',
      managedLine('https://p.example', 'i'),
    );

    expect(firstLine(composed)).toBe(managedLine('https://p.example', 'i'));
    expect(composed.split('\n').slice(1)).toEqual(['my notes', 'and more']);
  });

  it('replaces an older prisme line rather than stacking a second one', () => {
    const existing = `${managedLine('https://old.example', 'init-001')}\nmy notes`;

    const composed = composeDescription(existing, managedLine('https://new.example', 'init-001'));

    expect(composed.split('\n')).toHaveLength(2);
    expect(composed).not.toContain('old.example');
  });

  it('stays one line when there was nothing else there', () => {
    expect(composeDescription('', managedLine('https://p.example', 'i')).split('\n')).toHaveLength(
      1,
    );
  });
});

describe('labels', () => {
  it('adds prisme’s label without disturbing the ones the task tool owns', () => {
    expect(withLabel(['errand'], DEFAULT_ANCHOR_LABEL)).toEqual(['errand', 'prisme']);
    expect(withLabel(['prisme'], DEFAULT_ANCHOR_LABEL)).toEqual(['prisme']);
    expect(withoutLabel(['errand', 'prisme'], DEFAULT_ANCHOR_LABEL)).toEqual(['errand']);
  });

  it('reads a status request only when the suffix is a status', () => {
    expect(statusRequestIn(['prisme:status:waiting'], DEFAULT_STATUS_REQUEST_PREFIX)).toBe(
      'waiting',
    );
    expect(statusRequestIn(['prisme:status:soon'], DEFAULT_STATUS_REQUEST_PREFIX)).toBeUndefined();
    expect(statusRequestIn(['errand'], DEFAULT_STATUS_REQUEST_PREFIX)).toBeUndefined();
  });

  it('picks the same request when two are present, rather than one of them at random', () => {
    const labels = ['prisme:status:waiting', 'prisme:status:done'];

    expect(statusRequestIn(labels, DEFAULT_STATUS_REQUEST_PREFIX)).toBe(
      statusRequestIn([...labels].reverse(), DEFAULT_STATUS_REQUEST_PREFIX),
    );
  });
});

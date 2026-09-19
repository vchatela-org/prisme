import { describe, expect, it } from 'vitest';
import { formatValue, resolveFormat } from './value-format.js';

describe('formatValue', () => {
  it('writes a share with its sign', () => {
    expect(formatValue(32.46, { kind: 'percent' })).toBe('32%');
    expect(formatValue(32.46, { kind: 'percent', decimals: 1 })).toBe('32.5%');
  });

  it('writes a count with no decimals by default', () => {
    expect(formatValue(7, { kind: 'number' })).toBe('7');
    expect(formatValue(7.25, { kind: 'number', decimals: 2 })).toBe('7.25');
  });

  it('writes hours to one place by default', () => {
    expect(formatValue(3.25, { kind: 'hours' })).toBe('3.3h');
  });

  it('converts minutes to hours', () => {
    expect(formatValue(90, { kind: 'minutes-as-hours' })).toBe('1.5h');
    expect(formatValue(0, { kind: 'minutes-as-hours' })).toBe('0.0h');
  });

  it('writes a negative value without losing its sign', () => {
    expect(formatValue(-4, { kind: 'percent' })).toBe('-4%');
  });
});

describe('resolveFormat', () => {
  it('prefers an explicit function, so the prop is never silently overridden', () => {
    const format = resolveFormat((value) => `<${String(value)}>`, { kind: 'percent' });
    expect(format(5)).toBe('<5>');
  });

  it('uses the descriptor when that is all a server component could pass', () => {
    expect(resolveFormat(undefined, { kind: 'percent' })(12.6)).toBe('13%');
  });

  it('falls back to the chart default when neither is given', () => {
    // One decimal place — the behaviour every chart had before `formatAs`
    // existed, so adding the prop changed nothing for an existing caller.
    expect(resolveFormat(undefined, undefined)(12.34)).toBe('12.3');
  });
});

import { describe, expect, it } from 'vitest';
import type { ApiToken } from './contracts';
import {
  DEFAULT_EXPIRY_ID,
  EXPIRY_CHOICES,
  expirySeconds,
  groupScopes,
  mintProblem,
  orderTokens,
  tokenState,
} from './tokens-view';

function token(overrides: Partial<ApiToken>): ApiToken {
  return {
    id: 'fixture-token-a',
    name: 'fixture agent',
    scopes: ['read:focus'],
    createdAt: '2026-09-01T08:00:00.000Z',
    createdBy: 'subject-one',
    expiresAt: '2026-12-01T08:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    active: true,
    ...overrides,
  };
}

describe('the lifetimes offered', () => {
  it('default to the API’s own default and never pass its ceiling of a year', () => {
    expect(expirySeconds(DEFAULT_EXPIRY_ID)).toBe(90 * 24 * 60 * 60);
    expect(Math.max(...EXPIRY_CHOICES.map((choice) => choice.seconds))).toBe(365 * 24 * 60 * 60);
  });

  it('answer nothing for a lifetime they do not offer', () => {
    expect(expirySeconds('forever')).toBeUndefined();
  });
});

describe('groupScopes', () => {
  it('groups by prefix and keeps the API’s order within a group', () => {
    const groups = groupScopes([
      { name: 'read:focus', description: 'a', grantable: true },
      { name: 'write:ritual', description: 'b', grantable: true },
      { name: 'read:areas', description: 'c', grantable: true },
      { name: 'admin:tokens', description: 'd', grantable: false },
    ]);
    expect(groups.map((group) => group.kind)).toEqual(['read', 'write', 'admin']);
    expect(groups[0]?.items.map((scope) => scope.name)).toEqual(['read:focus', 'read:areas']);
  });

  it('shows a scope it cannot group rather than dropping it', () => {
    const groups = groupScopes([{ name: 'audit:everything', description: 'x', grantable: true }]);
    expect(groups).toEqual([expect.objectContaining({ kind: 'other' })]);
  });

  it('leaves out an empty group', () => {
    expect(groupScopes([])).toEqual([]);
  });
});

describe('a token, in words', () => {
  it('takes the API’s verdict on whether it is live, and says why not', () => {
    expect(tokenState(token({}))).toBe('active');
    expect(tokenState(token({ active: false, revokedAt: '2026-09-02T08:00:00.000Z' }))).toBe(
      'revoked',
    );
    expect(tokenState(token({ active: false }))).toBe('expired');
  });

  it('lists the live ones first without reordering either part', () => {
    const ordered = orderTokens([
      token({ id: 'fixture-token-a', active: false }),
      token({ id: 'fixture-token-b' }),
      token({ id: 'fixture-token-c', active: false }),
      token({ id: 'fixture-token-d' }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual([
      'fixture-token-b',
      'fixture-token-d',
      'fixture-token-a',
      'fixture-token-c',
    ]);
  });
});

describe('mintProblem', () => {
  it('asks for a name, then a scope, then nothing', () => {
    expect(mintProblem('  ', new Set(['read:focus']))).toMatch(/name/i);
    expect(mintProblem('x'.repeat(101), new Set(['read:focus']))).toMatch(/100/);
    expect(mintProblem('ritual loader', new Set())).toMatch(/scope/i);
    expect(mintProblem('ritual loader', new Set(['write:ritual']))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { classifyStatus, correlationIdOf, failureCopy, type ApiFailure } from './api-result';

describe('classifyStatus', () => {
  it('separates the three a reader can act on differently', () => {
    expect(classifyStatus(401)).toBe('unauthenticated');
    expect(classifyStatus(403)).toBe('forbidden');
    expect(classifyStatus(404)).toBe('not_found');
  });

  it('puts everything else in one bucket, including the write freeze and a rate limit', () => {
    for (const status of [400, 409, 422, 423, 429, 500, 502, 504]) {
      expect(classifyStatus(status)).toBe('unavailable');
    }
  });
});

describe('correlationIdOf', () => {
  it('reads the id out of an error body', () => {
    expect(correlationIdOf({ error: 'forbidden', correlationId: 'abc-123' })).toBe('abc-123');
  });

  it('is null for anything that is not one', () => {
    expect(correlationIdOf(null)).toBeNull();
    expect(correlationIdOf('forbidden')).toBeNull();
    expect(correlationIdOf({ correlationId: '' })).toBeNull();
    expect(correlationIdOf({ correlationId: 7 })).toBeNull();
  });
});

describe('failureCopy', () => {
  const failure = (overrides: Partial<ApiFailure>): ApiFailure => ({
    ok: false,
    kind: 'unavailable',
    correlationId: null,
    ...overrides,
  });

  it('names the surface that could not be read', () => {
    expect(failureCopy(failure({ kind: 'forbidden' }), 'the backlog').description).toContain(
      'the backlog',
    );
  });

  it('quotes the correlation id when there is one, and nothing else', () => {
    const copy = failureCopy(failure({ correlationId: 'abc-123' }), 'Focus');

    expect(copy.description).toContain('abc-123');
    expect(copy.description).not.toContain('undefined');
  });

  it('leaves no dangling sentence when there is no correlation id', () => {
    expect(failureCopy(failure({}), 'Focus').description).not.toContain('Correlation id');
  });

  it('distinguishes "not signed in" from "not permitted"', () => {
    // Deny-by-default working as designed is not an outage, and a reader told
    // to sign in again will do it twice and then file a bug.
    expect(failureCopy(failure({ kind: 'unauthenticated' }), 'Focus').title).toBe('Not signed in');
    expect(failureCopy(failure({ kind: 'forbidden' }), 'Focus').title).toBe('Not permitted');
  });
});

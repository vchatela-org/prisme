import { describe, expect, it } from 'vitest';
import { ConnectorError } from '@prisme/connectors';

import { documentToolLine, summariseUnread, unreadReason } from './unread.js';

/**
 * Why a store was not read.
 *
 * The row this closes: both role-read call sites swallowed their error and
 * printed **"not read"**, so a role nobody bound and a read that was refused
 * were the same six characters. The message must stay swallowed — it names the
 * role binding, which is instance data — and the failure kind is what may be
 * kept instead, because `errors.ts` rules it vendor vocabulary.
 */

function failure(kind: ConstructorParameters<typeof ConnectorError>[0]): ConnectorError {
  return new ConnectorError(kind, 'role processes_db; it is configured in the seed data', {
    tool: 'doc',
    operation: 'query processes_db',
  });
}

describe('unreadReason', () => {
  it('keeps the failure kind and drops the message', () => {
    const reason = unreadReason(failure('unbound_role'));

    expect(reason).toBe('unbound_role');
    // The identifier and the role key both live in the message, and neither may
    // reach a report.
    expect(JSON.stringify(reason)).not.toContain('processes_db');
  });

  it('tells an unbound role apart from a refused read, which is the point', () => {
    expect(unreadReason(failure('unbound_role'))).toBe('unbound_role');
    expect(unreadReason(failure('invalid_token'))).toBe('invalid_token');
    expect(unreadReason(failure('refused'))).toBe('refused');
  });

  it('answers `unknown` for an error that is not a connector failure', () => {
    // A throw from anywhere on the path — a driver, a stub, a bug in this repo.
    // Inventing a vendor reason for it would be worse than admitting the read
    // did not classify.
    expect(unreadReason(new Error('socket hang up'))).toBe('unknown');
    expect(unreadReason('not an error')).toBe('unknown');
    expect(unreadReason(undefined)).toBe('unknown');
  });

  it('is stable: two runs over an unchanged world classify the same error the same way', () => {
    expect(unreadReason(failure('unavailable'))).toBe(unreadReason(failure('unavailable')));
  });
});

describe('summariseUnread', () => {
  it('counts by kind', () => {
    expect(summariseUnread(['unbound_role', 'unbound_role', 'refused'])).toBe(
      '1 refused, 2 unbound_role',
    );
  });

  it('orders by kind, so the line does not depend on scan order', () => {
    // One `unbound_role` is a store nobody bound; four of them is a seed file
    // that was never loaded. The count is what carries that judgement, and the
    // order it is printed in must not depend on which role was scanned first.
    expect(summariseUnread(['refused', 'unbound_role', 'refused'])).toBe(
      '2 refused, 1 unbound_role',
    );
  });

  it('has nothing to say about nothing', () => {
    expect(summariseUnread([])).toBe('');
  });

  it('prints a count, never a role or an identifier', () => {
    expect(summariseUnread(['unbound_role'])).toBe('1 unbound_role');
  });
});

describe('documentToolLine', () => {
  it('says a configured-but-off tier is unread, with no reason invented', () => {
    // No client, or no duration property: the caller supplied that, so there is
    // no failure to report and the line must not imply one.
    expect(documentToolLine([], [])).toBe('not read');
  });

  it('names the reason when every role read failed', () => {
    expect(documentToolLine([], ['unbound_role', 'refused', 'refused'])).toBe(
      'not read — 2 refused, 1 unbound_role',
    );
  });

  it('names both the stores that were read and the reason the rest were not', () => {
    // The partial case, which is the one a real instance is in: some roles
    // bound, some not. A line that dropped the reason here would be the defect
    // again, only quieter.
    expect(documentToolLine(['objectives_db=64', 'takeaways_db=95'], ['unbound_role'])).toBe(
      'objectives_db=64   takeaways_db=95   not read — 1 unbound_role',
    );
  });

  it('says nothing about a reason when every role read', () => {
    expect(documentToolLine(['objectives_db=64'], [])).toBe('objectives_db=64');
  });
});

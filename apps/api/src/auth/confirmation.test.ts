import { describe, expect, it } from 'vitest';
import { createConfirmationService, hashPlan } from './confirmation.js';
import { createMemoryAuthStore } from './memory-store.js';

/**
 * The confirmation mechanism, and in particular the one test the brief names:
 * *a stale confirmation token is rejected, proven by a test that mutates state
 * between dry run and apply.*
 *
 * That test is written as an actual sequence — plan, change the world, replan,
 * apply — rather than as "hand it a different hash". The difference matters:
 * the second version passes even if nothing ever recomputes the plan, which is
 * exactly the bug the control exists to catch.
 */

/*
 * A principal id, in the shape the agent path produces (`token:<id>`) but
 * deliberately low-entropy and obviously not a credential.
 *
 * The first version of this line used a realistic 16-character id, and
 * `gitleaks` refused the commit: `token` in the name plus 4.0 bits of entropy
 * is its `generic-api-key` rule, and it was right to fire. A credential-shaped
 * literal in a source file is the thing the gate exists for, and the fix is the
 * fixture rather than the rule.
 */
const SUBJECT = 'token:the-planner';

function service(start = new Date('2026-09-18T10:00:00.000Z')) {
  const store = createMemoryAuthStore();
  let clock = start;
  return {
    store,
    advance: (seconds: number) => {
      clock = new Date(clock.getTime() + seconds * 1000);
    },
    confirmations: createConfirmationService({ store, now: () => clock }),
  };
}

/** A toy reconciler: the plan is a function of the world, recomputed each time. */
function planFor(world: Record<string, string>): { actions: { id: string; title: string }[] } {
  return {
    actions: Object.entries(world)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, title]) => ({ id, title: `set title to ${title}` })),
  };
}

describe('hashPlan', () => {
  it('does not depend on key order', () => {
    expect(hashPlan({ a: 1, b: 2 })).toBe(hashPlan({ b: 2, a: 1 }));
  });

  it('changes when anything in the plan changes', () => {
    expect(hashPlan({ a: 1 })).not.toBe(hashPlan({ a: 2 }));
    expect(hashPlan({ actions: [] })).not.toBe(hashPlan({ actions: [{ id: 'x' }] }));
  });
});

describe('plan, then apply', () => {
  it('accepts a confirmation for the diff that was shown', async () => {
    const bay = service();
    const world = { 'i-1': 'Ship the thing' };

    const diffHash = hashPlan(planFor(world));
    const issued = await bay.confirmations.issue({
      operation: 'sync.apply',
      diffHash,
      subject: SUBJECT,
    });

    // Nothing moved: the plan recomputes to the same diff.
    const record = await bay.confirmations.verify(issued.token, hashPlan(planFor(world)), SUBJECT);
    expect(record.operation).toBe('sync.apply');
  });

  it('rejects it when state moved between the dry run and the apply', async () => {
    const bay = service();
    const world: Record<string, string> = { 'i-1': 'Ship the thing' };

    // 1. Dry run. A human reads this diff and confirms it.
    const shown = hashPlan(planFor(world));
    const issued = await bay.confirmations.issue({
      operation: 'sync.apply',
      diffHash: shown,
      subject: SUBJECT,
    });

    // 2. The world moves — another pass, a human edit, anything.
    world['i-2'] = 'Something nobody confirmed';

    // 3. Apply recomputes against the world as it is now (ADR-0009), and the
    //    diff it would execute is not the diff that was authorised.
    const wouldApply = hashPlan(planFor(world));
    expect(wouldApply).not.toBe(shown);

    await expect(bay.confirmations.verify(issued.token, wouldApply, SUBJECT)).rejects.toMatchObject(
      {
        reason: 'stale',
      },
    );
  });

  it('is single-use', async () => {
    const bay = service();
    const diffHash = hashPlan(planFor({ 'i-1': 'Ship the thing' }));
    const issued = await bay.confirmations.issue({
      operation: 'sync.apply',
      diffHash,
      subject: SUBJECT,
    });

    await bay.confirmations.verify(issued.token, diffHash, SUBJECT);
    await expect(bay.confirmations.verify(issued.token, diffHash, SUBJECT)).rejects.toMatchObject({
      reason: 'consumed',
    });
  });

  it('is burnt by a failed attempt, so it is not a retry budget', async () => {
    const bay = service();
    const diffHash = hashPlan({ a: 1 });
    const issued = await bay.confirmations.issue({
      operation: 'sync.apply',
      diffHash,
      subject: SUBJECT,
    });

    await expect(
      bay.confirmations.verify(issued.token, hashPlan({ a: 2 }), SUBJECT),
    ).rejects.toMatchObject({ reason: 'stale' });
    // The correct hash no longer helps: the token was spent by the attempt.
    await expect(bay.confirmations.verify(issued.token, diffHash, SUBJECT)).rejects.toMatchObject({
      reason: 'consumed',
    });
  });

  it('expires', async () => {
    const bay = service();
    const diffHash = hashPlan({ a: 1 });
    const issued = await bay.confirmations.issue({
      operation: 'sync.apply',
      diffHash,
      subject: SUBJECT,
    });

    bay.advance(121);
    await expect(bay.confirmations.verify(issued.token, diffHash, SUBJECT)).rejects.toMatchObject({
      reason: 'expired',
    });
  });

  it('cannot be handed to another caller', async () => {
    const bay = service();
    const diffHash = hashPlan({ a: 1 });
    const issued = await bay.confirmations.issue({
      operation: 'sync.apply',
      diffHash,
      subject: SUBJECT,
    });

    await expect(
      bay.confirmations.verify(issued.token, diffHash, 'token:somebody-else'),
    ).rejects.toMatchObject({ reason: 'subject' });
  });

  it('refuses a token whose id exists but whose secret does not match', async () => {
    const bay = service();
    const diffHash = hashPlan({ a: 1 });
    const issued = await bay.confirmations.issue({
      operation: 'sync.apply',
      diffHash,
      subject: SUBJECT,
    });

    const id = issued.token.split('.')[0] as string;
    await expect(
      bay.confirmations.verify(`${id}.${'A'.repeat(43)}`, diffHash, SUBJECT),
    ).rejects.toMatchObject({ reason: 'secret' });
  });
});

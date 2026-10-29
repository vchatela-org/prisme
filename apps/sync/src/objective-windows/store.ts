import type postgres from 'postgres';
import type { ObjectiveWindowStep } from '@prisme/domain';
import type { ObjectiveWindowStore, OpenObjective } from './run.js';

type Sql = postgres.Sql;

/**
 * `objective` and `event_log`, for the window step (ADR-0037).
 *
 * A change and its event are one transaction, so the log never claims a move
 * that did not happen. Timestamps cross as text and JSON as
 * `JSON.stringify(…)::jsonb`, for the reason `state/postgres.ts` gives.
 */
export function createObjectiveWindowStore(client: Sql): ObjectiveWindowStore {
  return {
    async openObjectives(): Promise<readonly OpenObjective[]> {
      return client<OpenObjective[]>`
        select id::text as id, type, period, status
        from objective
        where status in ('draft', 'active')
        order by id`;
    },

    async applyStep(id: string, step: ObjectiveWindowStep, at: Date): Promise<boolean> {
      return client.begin(async (tx: postgres.TransactionSql) => {
        const moved = await tx`
          update objective set status = ${step.to}
          where id = ${id}::uuid and status = ${step.from}
          returning id`;
        if (moved.length === 0) return false;
        await tx`
          insert into event_log
            (kind, entity_kind, entity_id, field, before, after, actor, occurred_at)
          values ('status_changed', 'objective', ${id}, 'status',
                  ${JSON.stringify({ status: step.from })}::jsonb,
                  ${JSON.stringify({ status: step.to, reason: step.reason })}::jsonb,
                  'sync', ${at.toISOString()}::timestamptz)`;
        return true;
      });
    },
  };
}

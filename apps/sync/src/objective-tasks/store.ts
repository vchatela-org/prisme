import type postgres from 'postgres';
import type {
  InitiativeStatus,
  ObjectiveStatus,
  ObjectiveTaskInitiative,
  ObjectiveTaskMatch,
  ObjectiveTaskObjective,
} from '@prisme/domain';
import type { ObjectiveTaskStore } from './run.js';

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

/**
 * Why the initiative was dropped, as its own record says it. No title: the
 * objective is named by the event beside it, and the reason is product copy.
 */
export const OBJECTIVE_TASK_REASON =
  'It is an objective’s own task: its title is the objective’s, so the objective now holds the task (ADR-0038)';

/**
 * `initiative`, `objective`, `entity_external_ref`, `entity_link` and
 * `event_log`, for giving an objective its task (ADR-0038). The move is the
 * same one *Convert to key result* makes for a key result (S1), with the
 * objective as the holder: the task's binding moves, the initiative is dropped
 * and loses its anchor, and the link records an automatic, exact-title match.
 */
export function createObjectiveTaskStore(client: Sql): ObjectiveTaskStore {
  return {
    async initiatives(): Promise<readonly ObjectiveTaskInitiative[]> {
      const rows = await client<
        {
          id: string;
          title: string;
          area_key: string;
          status: InitiativeStatus;
          external_anchor_id: string | null;
        }[]
      >`
        select id::text, title, area_key, status, external_anchor_id
        from initiative
        order by id`;
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        areaKey: row.area_key,
        status: row.status,
        ...(row.external_anchor_id === null ? {} : { externalAnchorId: row.external_anchor_id }),
      }));
    },

    async objectives(): Promise<readonly ObjectiveTaskObjective[]> {
      const rows = await client<
        {
          id: string;
          title: string;
          area_key: string;
          status: ObjectiveStatus;
          holds_task: boolean;
        }[]
      >`
        select o.id::text, o.title, o.area_key, o.status,
               exists (select 1 from entity_external_ref r
                        where r.prisme_id = o.id::text and r.prisme_kind = 'objective'
                          and r.kind = 'task') as holds_task
        from objective o
        order by o.id`;
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        areaKey: row.area_key,
        status: row.status,
        holdsTask: row.holds_task,
      }));
    },

    async giveTaskToObjective(match: ObjectiveTaskMatch, at: Date): Promise<boolean> {
      return client.begin(async (tx: Tx) => {
        const [initiative] = await tx<{ status: string; external_anchor_id: string | null }[]>`
          select status, external_anchor_id from initiative
          where id = ${match.initiativeId}::uuid
          for update`;
        const [objective] = await tx<{ status: string }[]>`
          select status from objective where id = ${match.objectiveId}::uuid for update`;
        if (initiative === undefined || objective === undefined) return false;
        if (initiative.external_anchor_id !== match.externalTaskId) return false;
        if (['done', 'dropped'].includes(initiative.status)) return false;
        if (!['draft', 'active'].includes(objective.status)) return false;
        const held = await tx`
          select 1 from entity_external_ref
          where prisme_id = ${match.objectiveId} and prisme_kind = 'objective' and kind = 'task'`;
        if (held.length > 0) return false;

        const stamp = at.toISOString();
        await tx`
          delete from entity_external_ref
          where prisme_id = ${match.initiativeId} and kind = 'task'
            and external_id = ${match.externalTaskId}`;
        await tx`
          insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
          values (${match.objectiveId}, 'objective', 'task', ${match.externalTaskId})`;
        await tx`
          insert into entity_link
            (prisme_id, external_kind, external_id, match_rule, confidence, decided_by, decided_at)
          values (${match.objectiveId}, 'task', ${match.externalTaskId}, 'exact_title', 'certain',
                  'auto', ${stamp}::timestamptz)
          on conflict (prisme_id, external_kind, external_id) do nothing`;
        await tx`
          update initiative set
            status = 'dropped',
            dropped_reason = ${OBJECTIVE_TASK_REASON},
            external_anchor_id = null,
            updated_at = now()
          where id = ${match.initiativeId}::uuid`;
        await tx`
          insert into event_log
            (kind, entity_kind, entity_id, field, before, after, actor, occurred_at)
          values ('status_changed', 'initiative', ${match.initiativeId}, 'status',
                  ${JSON.stringify(initiative.status)}::jsonb, ${JSON.stringify('dropped')}::jsonb,
                  'sync', ${stamp}::timestamptz)`;
        await tx`
          insert into event_log
            (kind, entity_kind, entity_id, field, before, after, actor, occurred_at)
          values ('adoption_decision', 'objective', ${match.objectiveId}, null, null,
                  ${JSON.stringify({
                    decision: 'objective_task',
                    fromInitiative: match.initiativeId,
                    matchRule: 'exact_title',
                  })}::jsonb,
                  'sync', ${stamp}::timestamptz)`;
        return true;
      });
    },
  };
}

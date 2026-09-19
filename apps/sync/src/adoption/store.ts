import type postgres from 'postgres';
import type { Origin } from '@prisme/domain';
import { locationKey } from '../reconcile/types.js';
import type { AuditableEntity } from './coverage.js';
import type { AdoptionStore } from './ports.js';
import { externalKey, type Candidate, type DecidedSet, type MatchTarget } from './types.js';

/**
 * The {@link AdoptionStore} backed by PostgreSQL.
 *
 * Same two rules as `state/postgres.ts`, for the same reasons:
 *
 *   - **Every statement is a tagged template**, which postgres.js turns into a
 *     parameterised query. No value is concatenated into SQL, ever
 *     (docs/14-threat-model.md §5) — and everything this file handles is
 *     third-party text from two external tools.
 *   - **Timestamps cross the boundary as text.** Drizzle replaces the shared
 *     client's `timestamptz` serializer with the identity function, so a
 *     tagged-template query on the same client must hand the driver a string.
 *     W04 found this by running it; the comment is here so the next person does
 *     not find it the same way.
 *
 * One thing this file deliberately cannot do: **decide anything**. There is no
 * insert into `entity_link`, none into `entity_external_ref`, and none into
 * `adoption_ignore`. The scan proposes and mirrors; a human decides, through
 * the API.
 */

function stamp(at: Date): string {
  return at.toISOString();
}

interface TargetRow {
  readonly prisme_id: string;
  readonly kind: string;
  readonly title: string;
  readonly area_key: string | null;
  readonly closed: boolean;
}

interface AuditRow {
  readonly prisme_id: string;
  readonly kind: string;
  readonly origin: string;
  readonly bound: boolean;
}

export function createAdoptionStore(client: postgres.Sql): AdoptionStore {
  return {
    /**
     * Unbound entities of every matchable kind, in one union.
     *
     * "Unbound" is the `not exists` against `entity_external_ref`: an entity
     * already bound cannot be the answer to "what is this external object",
     * because guard 1 would refuse the second binding at the database.
     *
     * A `done` or `dropped` entity is still a target — closed matches closed
     * (docs/13-migration.md §3, "both open"). Dropping them would leave every
     * finished piece of work looking like a new candidate forever.
     */
    async loadTargets(): Promise<readonly MatchTarget[]> {
      const rows = await client<TargetRow[]>`
        select i.id::text as prisme_id, 'initiative' as kind, i.title, i.area_key,
               (i.status in ('done', 'dropped')) as closed
        from initiative i
        where not exists (
          select 1 from entity_external_ref r where r.prisme_id = i.id::text
        )
        union all
        select p.id::text, 'project', p.name, p.area_key,
               (p.status in ('done', 'dropped'))
        from project p
        where not exists (
          select 1 from entity_external_ref r where r.prisme_id = p.id::text
        )
        union all
        select k.id::text, 'key_result', k.statement, o.area_key,
               (o.status in ('met', 'missed', 'dropped'))
        from key_result k
        join objective o on o.id = k.objective_id
        where not exists (
          select 1 from entity_external_ref r where r.prisme_id = k.id::text
        )
        union all
        select t.id::text, 'ritual', t.name, t.area_key, false
        from ritual t
        where not exists (
          select 1 from entity_external_ref r where r.prisme_id = t.id::text
        )
        order by prisme_id`;

      return rows.map((row) => ({
        prismeId: row.prisme_id,
        kind: row.kind as MatchTarget['kind'],
        title: row.title,
        ...(row.area_key === null ? {} : { areaKey: row.area_key }),
        closed: row.closed,
      }));
    },

    /**
     * What a human has already settled: every link, and every ignore.
     *
     * Both are read in full rather than joined against the candidate set,
     * because the set is computed in memory from a full read of both tools and
     * the comparison is a set membership test. A few thousand keys is nothing;
     * a per-candidate query would be a round trip each.
     */
    async loadDecided(): Promise<DecidedSet> {
      const [links, ignores] = await Promise.all([
        client<{ external_kind: string; external_id: string }[]>`
          select external_kind, external_id from entity_link`,
        client<{ external_kind: string; external_id: string }[]>`
          select external_kind, external_id from adoption_ignore`,
      ]);

      const keyOf = (row: { external_kind: string; external_id: string }): string =>
        externalKey(row.external_kind as 'page' | 'project' | 'section' | 'task', row.external_id);

      return {
        linked: new Set(links.map(keyOf)),
        ignored: new Set(ignores.map(keyOf)),
      };
    },

    /**
     * Every entity that carries provenance, with whether it is bound.
     *
     * Initiatives and projects only — see {@link AuditableEntity}. Nothing
     * creates a key result or a ritual outward, so neither has an `origin`
     * column and neither can satisfy guard 2's predicate.
     */
    async loadAuditable(): Promise<readonly AuditableEntity[]> {
      const rows = await client<AuditRow[]>`
        select i.id::text as prisme_id, 'initiative' as kind, i.origin,
               exists (select 1 from entity_external_ref r where r.prisme_id = i.id::text) as bound
        from initiative i
        union all
        select p.id::text, 'project', p.origin,
               exists (select 1 from entity_external_ref r where r.prisme_id = p.id::text)
        from project p
        order by prisme_id`;

      return rows.map((row) => ({
        prismeId: row.prisme_id,
        kind: row.kind as AuditableEntity['kind'],
        origin: row.origin as Origin,
        bound: row.bound,
      }));
    },

    async loadAreaMap() {
      const [mappings, areas] = await Promise.all([
        client<
          { area_key: string; external_project_id: string; external_section_id: string | null }[]
        >`
          select area_key, external_project_id, external_section_id from area_mapping`,
        client<{ key: string; kind: string }[]>`select key, kind from area`,
      ]);

      const areaByLocation = new Map<string, string>();
      for (const row of mappings) {
        areaByLocation.set(
          locationKey(row.external_project_id, row.external_section_id ?? undefined),
          row.area_key,
        );
      }

      const laneByArea = new Map<string, 'area' | 'run' | 'signals'>();
      for (const row of areas) laneByArea.set(row.key, row.kind as 'area' | 'run' | 'signals');

      return { areaByLocation, laneByArea };
    },

    /**
     * Replace the mirror, in one transaction.
     *
     * Delete-then-insert rather than upsert-and-prune: the mirror *is* the last
     * scan, and a row surviving because nothing overwrote it is a candidate for
     * an object that may no longer exist. The whole statement commits or none
     * of it does, so a failed scan leaves the previous answer intact rather
     * than half of a new one.
     */
    async replaceCandidates(candidates: readonly Candidate[], scannedAt: Date): Promise<void> {
      const at = stamp(scannedAt);
      await client.begin(async (tx) => {
        await tx`delete from adoption_candidate`;
        if (candidates.length === 0) return;

        const rows = candidates.map((candidate) => ({
          external_kind: candidate.object.kind,
          external_id: candidate.object.externalId,
          title: candidate.object.title,
          area_key: candidate.object.areaKey ?? null,
          proposed_kind: candidate.classification.kind,
          reason: candidate.classification.reason,
          match_rule: candidate.proposal?.rule ?? null,
          confidence: candidate.proposal?.confidence ?? null,
          proposed_id: candidate.proposal?.prismeId ?? null,
          similarity: candidate.proposal?.similarity ?? null,
          scanned_at: at,
        }));

        await tx`insert into adoption_candidate ${tx(rows)}`;
      });
    },
  };
}

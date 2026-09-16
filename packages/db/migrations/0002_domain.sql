-- 0002 · domain tables
--
-- The tables behind packages/domain (W01). Specs: docs/10-model.md for shape,
-- docs/11-ownership.md for who owns each field, docs/12-scoring.md for scoring
-- and capacity, docs/13-migration.md for the no-duplicate guards.
--
-- Four invariants are enforced here rather than only in application code,
-- because a guard that lives in one process is a guard the next process has
-- not got:
--
--   1. UNIQUE (kind, external_id) on entity_external_ref  — Guard 1
--   2. `origin` cannot be updated                         — Guard 2
--   3. initiative dependencies stay acyclic, and the rejection prints the path
--   4. initiative_score, event_log and key_result_measurement are append-only
--
-- Two absences are deliberate and load-bearing:
--
--   * **No score column on `initiative`.** Scores are rows in initiative_score,
--     with the method and version that produced them (ADR-0006). A `wsjf`
--     column anywhere is a bug, not a shortcut.
--   * **No `due` column prisme writes.** Deadlines prioritize, dates plan
--     (ADR-0003). `task_mirror.due` exists because prisme *reads* it for
--     planned-versus-done; nothing in this repository writes it.
--
-- Statuses and kinds are `text` with a CHECK rather than a PostgreSQL enum.
-- The domain types in packages/domain are the source of truth for the closed
-- sets; a CHECK tracks them with an ordinary migration, where adding an enum
-- label is a separate DDL dialect nobody remembers under pressure.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS sync_conflict, last_applied, entity_link,
--     entity_external_ref, event_log, review_session, ritual_adherence, ritual,
--     takeaway, key_result_measurement, key_result, objective, task_mirror,
--     initiative_score, initiative_dependency, initiative, project,
--     area_mapping, area_weight, area CASCADE;
--   DROP FUNCTION IF EXISTS prisme_refuse_dependency_cycle,
--     prisme_refuse_origin_change, prisme_refuse_mutation;
--   DELETE FROM prisme_migration WHERE version = '0002';
-- Rehearsed against a throwaway database, never against the live one.

-- ---------------------------------------------------------------------------
-- Shared guards
-- ---------------------------------------------------------------------------

CREATE FUNCTION prisme_refuse_origin_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin IS DISTINCT FROM OLD.origin THEN
    RAISE EXCEPTION
      'origin is immutable after insert: % is % and cannot become %',
      OLD.id, OLD.origin, NEW.origin
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION prisme_refuse_origin_change() IS
  'Guard 2 (docs/13-migration.md §2): an adopted entity cannot become one prisme created, so it cannot produce a create action.';

CREATE FUNCTION prisme_refuse_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION prisme_refuse_mutation() IS
  'Append-only tables: history is the point, and an UPDATE would erase the fact being recorded.';

-- ---------------------------------------------------------------------------
-- Area, and the year-scoped weights
-- ---------------------------------------------------------------------------

CREATE TABLE area (
  key                       text PRIMARY KEY,
  name                      text NOT NULL,
  kind                      text NOT NULL CHECK (kind IN ('area', 'run', 'signals')),
  active                    boolean NOT NULL DEFAULT true,
  external_page_id          text,
  run_budget_hours_per_week numeric(5, 2),
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_budget_belongs_to_the_run_lane
    CHECK (run_budget_hours_per_week IS NULL OR kind = 'run')
);

COMMENT ON COLUMN area.kind IS
  'Lanes are areas with a different kind so capacity accounting is uniform (ADR-0014). Only ''area'' is ranked.';

CREATE TABLE area_weight (
  area_key   text NOT NULL REFERENCES area (key) ON DELETE RESTRICT,
  year       integer NOT NULL CHECK (year BETWEEN 1970 AND 9999),
  weight_pct numeric(5, 2) NOT NULL CHECK (weight_pct >= 0 AND weight_pct <= 100),
  PRIMARY KEY (area_key, year)
);

COMMENT ON TABLE area_weight IS
  'ADR-0007. The year is part of the key: there is no current weight, and no view may add one. Every balance factor and KPI computes against the weight in force at that time.';

CREATE TABLE area_mapping (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_key            text NOT NULL REFERENCES area (key) ON DELETE CASCADE,
  external_project_id text NOT NULL,
  external_section_id text
);

-- Many-to-one: several external projects and sections fold into one area, but
-- one external location belongs to exactly one area.
CREATE UNIQUE INDEX area_mapping_one_area_per_location
  ON area_mapping (external_project_id, COALESCE(external_section_id, ''));

-- ---------------------------------------------------------------------------
-- Project — the optional container (ADR-0019)
-- ---------------------------------------------------------------------------

CREATE TABLE project (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  area_key            text NOT NULL REFERENCES area (key) ON DELETE RESTRICT,
  status              text NOT NULL CHECK (status IN ('active', 'paused', 'done', 'dropped')),
  deadline            date,
  sections            text[] NOT NULL DEFAULT '{}',
  external_page_id    text,
  external_project_id text,
  origin              text NOT NULL CHECK (origin IN ('created_in_prisme', 'adopted')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER project_origin_is_immutable
  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION prisme_refuse_origin_change();

-- ---------------------------------------------------------------------------
-- Initiative — the only scored unit (ADR-0004)
-- ---------------------------------------------------------------------------

CREATE TABLE initiative (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  area_key           text NOT NULL REFERENCES area (key) ON DELETE RESTRICT,
  project_id         uuid REFERENCES project (id) ON DELETE SET NULL,
  status             text NOT NULL CHECK (status IN (
                       'inbox', 'later', 'next', 'now', 'waiting', 'review', 'done', 'dropped')),
  value              smallint NOT NULL CHECK (value IN (1, 2, 3, 5, 8, 13)),
  time_criticality   smallint NOT NULL CHECK (time_criticality IN (1, 2, 3, 5, 8, 13)),
  risk               smallint NOT NULL CHECK (risk IN (1, 2, 3, 5, 8, 13)),
  size               smallint NOT NULL CHECK (size IN (1, 2, 3, 5, 8, 13)),
  deadline           date,
  earliest_start     date,
  planned_start      date,
  planned_end        date,
  external_page_id   text,
  external_anchor_id text,
  origin             text NOT NULL CHECK (origin IN ('created_in_prisme', 'adopted')),
  done_at            date,
  dropped_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finished_work_says_when CHECK (status <> 'done' OR done_at IS NOT NULL),
  CONSTRAINT a_plan_has_two_ends
    CHECK ((planned_start IS NULL) = (planned_end IS NULL)),
  CONSTRAINT a_plan_ends_after_it_starts
    CHECK (planned_end IS NULL OR planned_end >= planned_start)
);

COMMENT ON TABLE initiative IS
  'The only scored unit (ADR-0004). No score column, ever: scores live in initiative_score with the method that produced them.';

COMMENT ON COLUMN initiative.area_key IS
  'Exactly one. A multi-area initiative breaks capacity accounting (docs/10-model.md §5).';

COMMENT ON COLUMN initiative.deadline IS
  'A hard external constraint, written outward to the anchor. Never a plan — prisme does not write `due` (ADR-0003).';

COMMENT ON COLUMN initiative.size IS
  'The size of the next slice. Above 8, slice it.';

CREATE INDEX initiative_by_area_and_status ON initiative (area_key, status);
CREATE INDEX initiative_by_deadline ON initiative (deadline) WHERE deadline IS NOT NULL;

CREATE TRIGGER initiative_origin_is_immutable
  BEFORE UPDATE ON initiative
  FOR EACH ROW EXECUTE FUNCTION prisme_refuse_origin_change();

-- ---------------------------------------------------------------------------
-- Dependencies — a DAG, refused at write time with the path in the error
-- ---------------------------------------------------------------------------

CREATE TABLE initiative_dependency (
  initiative_id uuid NOT NULL REFERENCES initiative (id) ON DELETE CASCADE,
  depends_on_id uuid NOT NULL REFERENCES initiative (id) ON DELETE CASCADE,
  PRIMARY KEY (initiative_id, depends_on_id),
  CONSTRAINT nothing_depends_on_itself CHECK (initiative_id <> depends_on_id)
);

CREATE INDEX initiative_dependency_reverse ON initiative_dependency (depends_on_id);

CREATE FUNCTION prisme_refuse_dependency_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reached uuid[];
BEGIN
  -- The new edge is initiative_id -> depends_on_id. It closes a cycle exactly
  -- when initiative_id is already reachable from depends_on_id. The row is not
  -- in the table yet, so the walk sees only the edges that were already there.
  WITH RECURSIVE walk (id, path) AS (
    SELECT NEW.depends_on_id, ARRAY[NEW.depends_on_id]
    UNION ALL
    SELECT d.depends_on_id, w.path || d.depends_on_id
    FROM walk w
    JOIN initiative_dependency d ON d.initiative_id = w.id
    WHERE NOT (d.depends_on_id = ANY (w.path))
  )
  SELECT w.path INTO reached
  FROM walk w
  WHERE w.id = NEW.initiative_id
  LIMIT 1;

  IF reached IS NOT NULL THEN
    RAISE EXCEPTION
      'initiative dependencies must be acyclic - found %',
      array_to_string(NEW.initiative_id || reached, ' -> ')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION prisme_refuse_dependency_cycle() IS
  'The path matters more than the rejection: "a -> b -> c -> a" is the fix, printed.';

CREATE TRIGGER initiative_dependency_stays_acyclic
  BEFORE INSERT OR UPDATE ON initiative_dependency
  FOR EACH ROW EXECUTE FUNCTION prisme_refuse_dependency_cycle();

-- ---------------------------------------------------------------------------
-- Scores — append-only, never a column (ADR-0006)
-- ---------------------------------------------------------------------------

CREATE TABLE initiative_score (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  initiative_id    uuid NOT NULL REFERENCES initiative (id) ON DELETE CASCADE,
  method_id        text NOT NULL,
  method_version   integer NOT NULL,
  score            double precision NOT NULL,
  factors          jsonb NOT NULL,
  explain          text NOT NULL,
  computed_at      timestamptz NOT NULL,
  is_active_method boolean NOT NULL
);

COMMENT ON TABLE initiative_score IS
  'Append-only. Knowing an item ranks fourth today is much less useful than knowing it ranked first for six weeks and was never picked.';

CREATE INDEX initiative_score_history
  ON initiative_score (initiative_id, computed_at DESC);
CREATE INDEX initiative_score_active_ranking
  ON initiative_score (method_id, computed_at DESC) WHERE is_active_method;

CREATE TRIGGER initiative_score_is_append_only
  BEFORE UPDATE OR DELETE ON initiative_score
  FOR EACH ROW EXECUTE FUNCTION prisme_refuse_mutation();

-- ---------------------------------------------------------------------------
-- Task mirror — owned entirely by the task tool, read-only here
-- ---------------------------------------------------------------------------

CREATE TABLE task_mirror (
  external_id        text PRIMARY KEY,
  external_parent_id text,
  anchor_for         uuid REFERENCES initiative (id) ON DELETE SET NULL,
  area_key           text REFERENCES area (key) ON DELETE SET NULL,
  is_anchor          boolean NOT NULL DEFAULT false,
  completed          boolean NOT NULL DEFAULT false,
  completed_at       timestamptz,
  recorded_minutes   integer CHECK (recorded_minutes IS NULL OR recorded_minutes >= 0),
  due                date,
  priority           text CHECK (priority IS NULL OR priority IN ('highest', 'high', 'medium', 'lowest')),
  observed_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE task_mirror IS
  'The anchor subtree, mirrored read-only. Subtasks are counted, never copied: mirroring leaves you maintaining two task lists.';

COMMENT ON COLUMN task_mirror.due IS
  'The task tool owns this. prisme reads it for planned-versus-done and never writes it (ADR-0003, docs/11-ownership.md §5).';

CREATE INDEX task_mirror_completions
  ON task_mirror (area_key, completed_at) WHERE completed;

-- ---------------------------------------------------------------------------
-- Objectives and key results (ADR-0012, ADR-0013)
-- ---------------------------------------------------------------------------

CREATE TABLE objective (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  type             text NOT NULL CHECK (type IN ('annual', 'monthly')),
  period           text NOT NULL CHECK (period ~ '^\d{4}(-\d{2})?$'),
  area_key         text NOT NULL REFERENCES area (key) ON DELETE RESTRICT,
  status           text NOT NULL CHECK (status IN ('draft', 'active', 'met', 'missed', 'dropped')),
  external_page_id text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE key_result (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id       uuid NOT NULL REFERENCES objective (id) ON DELETE CASCADE,
  statement          text NOT NULL,
  target             double precision NOT NULL,
  unit               text NOT NULL,
  progress_self      smallint NOT NULL DEFAULT 0 CHECK (progress_self BETWEEN 0 AND 100),
  external_anchor_id text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN key_result.progress_self IS
  'Self-assessed, by judgement. The primary measure, and the one that syncs outward. progress_computed is derived and never stored (ADR-0013).';

CREATE TABLE key_result_served_by (
  key_result_id uuid NOT NULL REFERENCES key_result (id) ON DELETE CASCADE,
  initiative_id uuid NOT NULL REFERENCES initiative (id) ON DELETE CASCADE,
  PRIMARY KEY (key_result_id, initiative_id)
);

CREATE TABLE key_result_measurement (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_result_id uuid NOT NULL REFERENCES key_result (id) ON DELETE CASCADE,
  observed_at   timestamptz NOT NULL,
  value         double precision NOT NULL,
  note          text
);

CREATE INDEX key_result_measurement_series
  ON key_result_measurement (key_result_id, observed_at);

CREATE TRIGGER key_result_measurement_is_append_only
  BEFORE UPDATE OR DELETE ON key_result_measurement
  FOR EACH ROW EXECUTE FUNCTION prisme_refuse_mutation();

-- ---------------------------------------------------------------------------
-- Lanes: takeaways and rituals (ADR-0014)
-- ---------------------------------------------------------------------------

CREATE TABLE takeaway (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('principle', 'action')),
  external_page_id text NOT NULL,
  area_key         text REFERENCES area (key) ON DELETE SET NULL,
  promoted_to      uuid REFERENCES initiative (id) ON DELETE SET NULL,
  observed_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE takeaway IS
  'Owned outright by the document tool. A principle never enters the backlog; an action is a candidate. Promotion links, and never copies or modifies the takeaway.';

CREATE TABLE ritual (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  area_key              text NOT NULL REFERENCES area (key) ON DELETE RESTRICT,
  cadence               text NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  target_adherence_pct  smallint NOT NULL CHECK (target_adherence_pct BETWEEN 0 AND 100),
  external_page_id      text
);

CREATE TABLE ritual_adherence (
  ritual_id     uuid NOT NULL REFERENCES ritual (id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  opportunities integer NOT NULL CHECK (opportunities >= 0),
  completions   integer NOT NULL CHECK (completions >= 0),
  PRIMARY KEY (ritual_id, period_start),
  CONSTRAINT adherence_cannot_exceed_opportunity CHECK (completions <= opportunities)
);

COMMENT ON TABLE ritual_adherence IS
  'The metric neither external tool provides. A habit is measured by adherence over time, not by completion.';

-- ---------------------------------------------------------------------------
-- Reviews and the event log
-- ---------------------------------------------------------------------------

CREATE TABLE review_session (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence           text NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  started_at        timestamptz NOT NULL,
  completed_at      timestamptz,
  checklist         jsonb NOT NULL DEFAULT '{}'::jsonb,
  decisions         text[] NOT NULL DEFAULT '{}',
  capacity_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_page_id  text
);

CREATE TABLE event_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN (
                'score_changed', 'status_changed', 'weight_changed',
                'completed', 'sync_action', 'adoption_decision')),
  entity_kind text NOT NULL,
  entity_id   text NOT NULL,
  field       text,
  before      jsonb,
  after       jsonb,
  actor       text NOT NULL CHECK (actor IN ('human', 'agent', 'sync')),
  occurred_at timestamptz NOT NULL
);

COMMENT ON TABLE event_log IS
  'Append-only, prisme-only. Load-bearing three times over: KPIs, replanning, and the security audit trail (docs/14-threat-model.md).';

CREATE INDEX event_log_by_entity ON event_log (entity_kind, entity_id, occurred_at DESC);
CREATE INDEX event_log_by_time ON event_log (occurred_at DESC);

CREATE TRIGGER event_log_is_append_only
  BEFORE UPDATE OR DELETE ON event_log
  FOR EACH ROW EXECUTE FUNCTION prisme_refuse_mutation();

-- ---------------------------------------------------------------------------
-- External references, links, last-applied values and the conflict ledger
-- ---------------------------------------------------------------------------

CREATE TABLE entity_external_ref (
  prisme_id   text NOT NULL,
  prisme_kind text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('page', 'project', 'section', 'task')),
  external_id text NOT NULL,
  PRIMARY KEY (prisme_id, kind, external_id)
);

-- Guard 1 (docs/13-migration.md §2). An external object bound to one prisme
-- entity cannot be bound to another. The database refuses it; no application
-- logic is trusted with this.
CREATE UNIQUE INDEX entity_external_ref_binds_once
  ON entity_external_ref (kind, external_id);

CREATE TABLE entity_link (
  prisme_id     text NOT NULL,
  external_kind text NOT NULL CHECK (external_kind IN ('page', 'project', 'section', 'task')),
  external_id   text NOT NULL,
  match_rule    text NOT NULL CHECK (match_rule IN (
                  'existing_mapping', 'exact_title', 'normalised_title', 'fuzzy_title', 'manual')),
  confidence    text NOT NULL CHECK (confidence IN ('certain', 'high', 'medium', 'low', 'manual')),
  decided_by    text NOT NULL CHECK (decided_by IN ('auto', 'human')),
  decided_at    timestamptz NOT NULL,
  PRIMARY KEY (prisme_id, external_kind, external_id),
  CONSTRAINT only_certainty_is_automatic
    CHECK (decided_by = 'human' OR confidence = 'certain')
);

COMMENT ON CONSTRAINT only_certainty_is_automatic ON entity_link IS
  'Nothing above "certain" is auto-applied. An automatic fuzzy match that is wrong corrupts silently (docs/13-migration.md §3).';

CREATE TABLE last_applied (
  entity_kind text NOT NULL,
  entity_id   text NOT NULL,
  field       text NOT NULL,
  value       text,
  applied_at  timestamptz NOT NULL,
  PRIMARY KEY (entity_kind, entity_id, field)
);

COMMENT ON TABLE last_applied IS
  'What prisme most recently wrote into a field it does not own. Without it the only options are never propagating (useless) and stomping deliberate edits (infuriating) — docs/16-sync.md §5.';

CREATE TABLE sync_conflict (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id      text NOT NULL,
  field          text NOT NULL,
  prisme_value   text,
  external_value text,
  detected_at    timestamptz NOT NULL,
  resolution     text NOT NULL CHECK (resolution IN ('prisme_wins', 'external_wins', 'unresolved')),
  actor          text NOT NULL CHECK (actor IN ('sync', 'human'))
);

COMMENT ON TABLE sync_conflict IS
  'Conflicts are a design signal. A field conflicting repeatedly is a field whose ownership is wrong (docs/16-sync.md §4).';

CREATE INDEX sync_conflict_outstanding
  ON sync_conflict (detected_at DESC) WHERE resolution = 'unresolved';

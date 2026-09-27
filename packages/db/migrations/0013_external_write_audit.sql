-- 0013 · the audit of outward writes, and how long it is kept
--
-- ADR-0031. Until this migration the only trace of an outward write was a
-- `sync_action` row in `event_log`, written by the reconciler for an action
-- that **succeeded** — so a failed call left nothing, the creation ledger's
-- calls left nothing, and no row said which tool was written to or what was
-- sent. Lifting the write freeze (docs/13-migration.md §5 step 8) needs a
-- record a person can read of every call prisme makes to either tool.
--
-- ## 1. `external_write` — one row per outward call
--
-- Written by the writers themselves (`@prisme/connectors/write`, `audit.ts`),
-- which are decorated where they are constructed, so no call site has to
-- remember. A failed call is a row like any other, with `failure` naming the
-- connector's failure kind and `error` a message that is redacted by
-- construction.
--
-- `request` is what prisme asked for, in its own vocabulary — the draft, the
-- patch, the location. It is **instance data**, like `external_id`: titles and
-- contents from a real workspace, rendered to the owner and never logged.
--
-- `entity_kind` / `entity_id` name the prisme entity the call was made for,
-- when the pass knew it: the initiative an anchor belongs to, the intent's
-- entity for a creation. They are text, not foreign keys, for the reason
-- `event_log.entity_id` is — a record must outlive what it describes.
--
-- ## 2. It is pruned by age, and it is not the event log
--
-- `event_log` stays exactly as it is: append-only, never deleted from, and the
-- source of the KPIs and of the rollback in docs/13-migration.md §7. This table
-- grows with every pass instead, so a row is deleted once it is older than the
-- retention window. **A row is never changed**: the trigger refuses UPDATE, and
-- DELETE is allowed because pruning is what it is for. The application role
-- already holds DELETE on every table through the default privileges, so no
-- GRANT is needed here.
--
-- ## 3. `audit_setting` — the window, chosen on the Settings screen
--
-- A singleton the application upserts, like `sync_run_state`: no row means
-- nothing has been chosen, and the default applies (`WRITE_AUDIT_RETENTION` in
-- packages/domain, which is also where the bounds below come from). The bounds
-- are repeated as a CHECK so the database refuses a window the domain would.
--
-- Additive and forward-only. No backfill: the `sync_action` rows already in
-- `event_log` stay there and are not copied, because they do not say what was
-- sent.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS audit_setting;
--   DROP TABLE IF EXISTS external_write;
--   DELETE FROM prisme_migration WHERE version = '0013';
-- Reversing this loses the audit and nothing else: no other table reads it.

CREATE TABLE external_write (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at     timestamptz NOT NULL,
  tool            text NOT NULL CHECK (tool IN ('document', 'task')),
  operation       text NOT NULL CHECK (operation IN (
                    'create_anchor', 'update_task', 'move_task',
                    'create_project', 'create_section', 'create_capture_task',
                    'create_page')),
  origin          text NOT NULL CHECK (origin IN ('reconciler', 'creation')),
  run_id          text NOT NULL,
  entity_kind     text,
  entity_id       text,
  external_id     text,
  request         jsonb NOT NULL,
  idempotency_key text NOT NULL,
  outcome         text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  failure         text,
  error           text,
  duration_ms     integer NOT NULL CHECK (duration_ms >= 0),
  -- A failure names its kind, and a success has none: the filter on the screen
  -- and the row's own story must agree.
  CONSTRAINT external_write_failure_iff_failed
    CHECK ((outcome = 'failed') = (failure IS NOT NULL))
);

COMMENT ON TABLE external_write IS
  'One row per outward call to the document or task tool, failures included (ADR-0031). Rows are never changed; they are deleted once older than audit_setting.retention_days.';
COMMENT ON COLUMN external_write.request IS
  'What prisme asked for, in its own vocabulary. Instance data: rendered to the owner, never logged, never committed.';

CREATE INDEX external_write_by_time ON external_write (occurred_at DESC, id DESC);

CREATE FUNCTION prisme_refuse_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never changed; UPDATE is refused', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER external_write_is_immutable
  BEFORE UPDATE ON external_write
  FOR EACH ROW EXECUTE FUNCTION prisme_refuse_update();

CREATE TABLE audit_setting (
  id              text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  retention_days  integer NOT NULL CHECK (retention_days BETWEEN 7 AND 3650),
  updated_at      timestamptz NOT NULL
);

COMMENT ON TABLE audit_setting IS
  'One row, upserted from the Settings screen. No row: the default window in packages/domain (WRITE_AUDIT_RETENTION) applies.';

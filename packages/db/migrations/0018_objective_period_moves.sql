-- 0018 · an open objective's period can move, and its page's dates follow
--
-- An objective's period was fixed at authoring, and one adopted from an
-- objectives page took its period from the page's dates once, at adoption —
-- so a period chosen wrongly, or a plan that moved, could not be corrected
-- anywhere, and a change made in the document tool never reached prisme.
-- ADR-0034 lets an **open** objective (draft or active) move to another
-- period, records each move, and makes the date column of the objective's
-- linked page the outward form of that period: the sync writes it.
--
-- Two vocabularies grow, and nothing else changes:
--
--   - `external_write.operation` gains `update_page`: the one property of an
--     objectives-store entry prisme writes — its date column (ADR-0031 audits
--     every outward call, and this is a new kind of call).
--   - `event_log.kind` gains `period_changed`: an objective's move from one
--     period to another, `before` and `after` as `{ type, period }`, so the
--     move stays part of the objective's history rather than overwriting it.
--
-- What prisme last wrote into a page's date column is kept in `last_applied`
-- (entity kind `objective_page`), which names no entity kind in its schema, and
-- a hand edit it overwrites goes to `sync_conflict`, which names none either.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DELETE FROM external_write WHERE operation = 'update_page';
--   ALTER TABLE external_write DROP CONSTRAINT external_write_operation_check,
--     ADD CONSTRAINT external_write_operation_check CHECK (operation IN (
--       'create_anchor', 'update_task', 'move_task',
--       'create_project', 'create_section', 'create_capture_task',
--       'create_page'));
--   DELETE FROM last_applied WHERE entity_kind = 'objective_page';
--   DELETE FROM prisme_migration WHERE version = '0018';
-- `event_log` is deliberately **not** reversed. It is append-only — its
-- trigger refuses a DELETE — and its `period_changed` rows are the record of
-- each move, so the widened CHECK stays. The cost of rolling back to an image
-- before this one: its `/events` does not know the kind, so reading an
-- objective's events there fails until it is rolled forward again.
-- Rehearsed with an `update_page` and a `period_changed` row present, in a
-- rolled-back transaction against a throwaway database, never the live one.

ALTER TABLE external_write
  DROP CONSTRAINT external_write_operation_check,
  ADD CONSTRAINT external_write_operation_check CHECK (operation IN (
    'create_anchor', 'update_task', 'move_task',
    'create_project', 'create_section', 'create_capture_task',
    'create_page', 'update_page'));

ALTER TABLE event_log
  DROP CONSTRAINT event_log_kind_check,
  ADD CONSTRAINT event_log_kind_check CHECK (kind IN (
    'score_changed', 'status_changed', 'weight_changed',
    'completed', 'sync_action', 'adoption_decision', 'period_changed'));

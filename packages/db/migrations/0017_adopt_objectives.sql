-- 0017 · an objectives page is proposed as an objective
--
-- The scan proposed every page of the objectives store as a `key_result`, and
-- *Adopt* refuses a key result — it needs an objective and a target, and a
-- candidate carries neither. So the store had no way into prisme at all: no
-- adopt, and no merge either, because a page was matched against key results
-- only and an instance that has never adopted anything has none.
--
-- The model already said what such a page is: an Objective, whose narrative
-- stays in the document tool and whose `external_page_id` links to it
-- (docs/10-model.md §7). ADR-0033, amended 2026-09-28, lifts the refusal for
-- it: the scan proposes `objective`, and *Adopt* creates one seeded once from
-- the page — its title, its area (the store's area column), and its type and
-- period from the store's date column, which must be exactly one calendar year
-- or one calendar month.
--
-- Only the candidate mirror's vocabulary changes. `objective` already has
-- every column adoption fills, and `entity_link` names no entity kind. Rows
-- mirrored before this migration keep `key_result` until the next scan, which
-- replaces the mirror wholesale — so *Rescan* after it rolls.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DELETE FROM adoption_candidate WHERE proposed_kind = 'objective';
--   ALTER TABLE adoption_candidate DROP CONSTRAINT adoption_candidate_proposed_kind_check,
--     ADD CONSTRAINT adoption_candidate_proposed_kind_check CHECK (proposed_kind IN (
--       'initiative', 'project', 'key_result', 'ritual', 'run', 'signal', 'takeaway', 'task'));
--   DELETE FROM prisme_migration WHERE version = '0017';
-- Rehearsed against a throwaway database, never against the live one. The
-- deleted rows are a mirror: the next scan writes them back as key results.
-- Objectives already adopted are untouched.

ALTER TABLE adoption_candidate
  DROP CONSTRAINT adoption_candidate_proposed_kind_check,
  ADD CONSTRAINT adoption_candidate_proposed_kind_check CHECK (proposed_kind IN (
    'initiative', 'project', 'objective', 'key_result', 'ritual',
    'run', 'signal', 'takeaway', 'task'));

-- 0014 · which completions an area's observed share was made of
--
-- The area screen said an area had received half of the window's attributed
-- time and could not say which tasks that was. `capacity_week` holds a count
-- and a sum per week and area, and nothing below it survived: `materialise`
-- attributed each completion in memory, summed, and threw the rows away. A
-- share nobody can take apart is a share that gets overridden once and then
-- ignored — the failure the explainability rule exists to prevent.
--
-- ## 1. `completion_history.content` — the title a completion had
--
-- ADR-0032. The task tool's own field, read and never written; the only part
-- of a task's content prisme keeps, and only for a task that is already done.
-- Nullable because every row fetched before this migration has none, and
-- because the tool may send none. The fetch upserts it, so a re-fetch of the
-- trailing window refreshes a renamed title and a response without one never
-- erases it.
--
-- ## 2. `capacity_completion` — the attributed rows behind `capacity_week`
--
-- **Derived and disposable**, exactly like `capacity_week`, and written in the
-- same transaction over the same weeks — so the two cannot disagree, and the
-- rows of one area in one window always sum to that window's weeks.
--
-- It carries an `area_key`, which 0006 forbids in `completion_history`, and
-- the rule is kept rather than bent: 0006's objection is that a stored area
-- freezes a mapping decision into history that is never recomputed. This table
-- *is* the recomputation — replaced wholesale for every week in range on each
-- run, like the weekly rows beside it. Changing a mapping re-attributes it on
-- the next run without a fetch, which is the property 0006 protects.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS capacity_completion;
--   ALTER TABLE completion_history DROP COLUMN IF EXISTS content;
--   DELETE FROM prisme_migration WHERE version = '0014';
-- Rehearsed against a throwaway database, never against the live one. The
-- first loses nothing — the next run rebuilds it. The second loses the titles,
-- which come back only for completions a later fetch covers.

ALTER TABLE completion_history ADD COLUMN content text;

COMMENT ON COLUMN completion_history.content IS
  'The completed task''s title as the tool reported it, sanitised to plain text (ADR-0032). Instance data: it lives in this database and never in the repository (docs/17-privacy.md). Read, never written.';

CREATE TABLE capacity_completion (
  external_task_id  text NOT NULL,
  completed_at      timestamptz NOT NULL,
  area_key          text NOT NULL REFERENCES area (key) ON DELETE CASCADE,
  -- ADR-0014's four lanes, as `attribute` labels a completion.
  lane              text NOT NULL CHECK (lane IN ('change', 'run', 'signals', 'ritual')),
  -- Zero for the Signals lane, by the same rule `capacity_week.minutes` follows.
  minutes           integer NOT NULL CHECK (minutes >= 0),
  -- Which tier of the duration preference order the minutes came from
  -- (docs/12-scoring.md §4), so a row can say it is an estimate.
  minutes_source    text NOT NULL CHECK (minutes_source IN ('recorded', 'declared', 'default')),
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (external_task_id, completed_at)
);

COMMENT ON TABLE capacity_completion IS
  'Derived and disposable: the attributed completions capacity_week sums. Replaced with it, in one transaction, for every week in range on each run; recomputable from completion_history and area_mapping at any time.';

CREATE INDEX capacity_completion_by_area ON capacity_completion (area_key, completed_at);

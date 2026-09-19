-- 0005 · the adoption queue
--
-- What W12 has to remember between a scan and a human working through its
-- output. Specs: docs/13-migration.md in full, ADR-0010 for the four guards.
--
-- The split between these two tables is the whole design, so it is written here
-- rather than inferred from the column lists:
--
--   * `adoption_candidate` is a **mirror of the last scan**. It is derived, it
--     is replaced wholesale every run, and deleting it costs nothing but the
--     next scan. Nothing a human decided is stored in it.
--   * `adoption_ignore` is a **decision**, and decisions are never rewritten by
--     a scan. It is append-only for the same reason event_log is: "the item
--     never reappears" (docs/13-migration.md §4) is a promise about the future,
--     and a promise a later UPDATE can quietly withdraw is not one.
--
-- The third table this workstream writes, `entity_link`, already exists — W01
-- shipped it with the constraint that does the load-bearing work here:
-- `only_certainty_is_automatic`. Nothing above "certain" can be applied by a
-- machine, and that is a database constraint rather than an `if` somebody can
-- delete while refactoring.
--
-- **There is no `adoption_decision` table.** An adopt or a merge *is* an
-- `entity_link` row; giving it a second home would mean two answers to "is this
-- adopted", and the queue would eventually disagree with the reconciler.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS adoption_candidate;
--   DROP TABLE IF EXISTS adoption_ignore;
--   DROP FUNCTION IF EXISTS prisme_refuse_unignore;
--   DELETE FROM prisme_migration WHERE version = '0005';
-- Rehearsed against a throwaway database, never against the live one. Note that
-- reversing this discards every *ignore* ever recorded, so the next scan
-- re-proposes items a human has already refused once — which is the queue
-- failing to converge, the exact failure §4 is about.

-- ---------------------------------------------------------------------------
-- The last scan's candidates
-- ---------------------------------------------------------------------------

CREATE TABLE adoption_candidate (
  external_kind  text NOT NULL CHECK (external_kind IN ('page', 'project', 'section', 'task')),
  external_id    text NOT NULL,
  -- Instance data: a real title from a real workspace. It lives in this
  -- database and never in the repository (docs/17-privacy.md).
  title          text NOT NULL,
  -- Where the external object sits, so the queue can be worked one area at a
  -- time. Null when no area_mapping covers its location — which is itself a
  -- finding, not an error.
  area_key       text REFERENCES area (key) ON DELETE SET NULL,
  -- What docs/13-migration.md §4 "what becomes what" says this should become.
  -- `task` and `takeaway` are the two that mean *leave it alone*: most tasks
  -- are just tasks, and a principle never enters the backlog.
  proposed_kind  text NOT NULL CHECK (proposed_kind IN (
                   'initiative', 'project', 'key_result', 'ritual',
                   'run', 'signal', 'takeaway', 'task')),
  -- Why the classifier said so, in prisme's vocabulary. Displayed, never parsed.
  reason         text NOT NULL,
  -- The identity-resolution proposal, if any (docs/13-migration.md §3). A
  -- candidate with no proposal is the manual remainder, and counting it is the
  -- point of the coverage report.
  match_rule     text CHECK (match_rule IN (
                   'existing_mapping', 'exact_title', 'normalised_title', 'fuzzy_title', 'manual')),
  confidence     text CHECK (confidence IN ('certain', 'high', 'medium', 'low', 'manual')),
  proposed_id    text,
  -- 0–1, only for a fuzzy proposal. Shown to the human with the suggestion,
  -- because a similarity nobody can see is a number nobody can disagree with.
  similarity     numeric(4, 3) CHECK (similarity >= 0 AND similarity <= 1),
  scanned_at     timestamptz NOT NULL,
  PRIMARY KEY (external_kind, external_id),
  -- A proposal is a triple. Half a proposal would render as a rule with nothing
  -- to apply it to, and a human would be asked to confirm a blank.
  CONSTRAINT proposal_is_whole_or_absent CHECK (
    (match_rule IS NULL AND confidence IS NULL AND proposed_id IS NULL)
    OR (match_rule IS NOT NULL AND confidence IS NOT NULL AND proposed_id IS NOT NULL)
  ),
  CONSTRAINT similarity_belongs_to_a_fuzzy_proposal CHECK (
    similarity IS NULL OR match_rule = 'fuzzy_title'
  )
);

COMMENT ON TABLE adoption_candidate IS
  'A mirror of the last scan, replaced wholesale each run (ADR-0009 applies here too: level-triggered, never a queue of events). Holds no decision, so truncating it loses nothing.';

COMMENT ON COLUMN adoption_candidate.proposed_kind IS
  'docs/13-migration.md §4. The trap is over-promotion: ''task'' is the right answer far more often than ''initiative'', and a classifier that never says so rebuilds the original problem with more ceremony.';

CREATE INDEX adoption_candidate_by_area ON adoption_candidate (area_key, proposed_kind);

-- ---------------------------------------------------------------------------
-- Ignore — what makes the queue converge
-- ---------------------------------------------------------------------------

CREATE FUNCTION prisme_refuse_unignore() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'an ignore is permanent: % on % cannot be % (docs/13-migration.md section 4)',
    TG_TABLE_NAME, OLD.external_id, TG_OP
    USING ERRCODE = 'check_violation',
          HINT = 'An ignored object is still adoptable by explicit external id; it is only kept out of the queue.';
END;
$$;

COMMENT ON FUNCTION prisme_refuse_unignore() IS
  'A queue that re-proposes the same items every week gets abandoned in a fortnight, and then the model quietly diverges from reality (docs/13-migration.md section 4).';

CREATE TABLE adoption_ignore (
  external_kind text NOT NULL CHECK (external_kind IN ('page', 'project', 'section', 'task')),
  external_id   text NOT NULL,
  -- Why a human passed on it. Free text, and the only field here that is for
  -- the next human rather than for the scan.
  reason        text,
  -- No 'auto'. Nothing ignores an item on a human's behalf: an item the scan
  -- could dismiss by itself is one the classifier should not have proposed.
  decided_by    text NOT NULL DEFAULT 'human' CHECK (decided_by = 'human'),
  decided_at    timestamptz NOT NULL,
  PRIMARY KEY (external_kind, external_id)
);

COMMENT ON TABLE adoption_ignore IS
  'Permanent, and append-only so that it stays permanent. Ignore removes an object from the queue, not from existence — it can still be adopted by explicit external id, which is the escape hatch for a mis-click that does not cost convergence.';

CREATE TRIGGER adoption_ignore_is_permanent
  BEFORE UPDATE OR DELETE ON adoption_ignore
  FOR EACH ROW EXECUTE FUNCTION prisme_refuse_unignore();

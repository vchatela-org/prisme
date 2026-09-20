-- 0007 · captures, and the ledger of what prisme intends to create outward
--
-- The three creation flows (docs/40-workstreams/W15-creation-flows.md) all hit
-- the same wall: **there is no transaction spanning two SaaS APIs.** Creating a
-- project means a prisme row, a project in the task tool, one section per
-- subtopic, and a page in the document tool — four writes across three systems,
-- any of which can time out having succeeded.
--
-- The answer is not a bigger try/catch. It is to make the *intention* durable
-- before anything outward is attempted, so a partial creation is a row that
-- says what is still missing rather than an orphan nobody can find.
--
--   * `capture` is the small shape: a thing that arrives, becomes a task, and
--     **stays a task**. Not everything is an initiative. It is here rather than
--     as an initiative with a flag because an initiative is the scored unit
--     (ADR-0004), and a scored unit nobody scored is how the previous system
--     accumulated its "missing score" backlog.
--   * `creation_intent` is the ledger: one row per external object prisme has
--     decided should exist and has not yet confirmed does. A converge pass
--     drains it, and `prisme_id` is bound in `entity_external_ref` exactly as
--     an adopted object's is — the two paths meet at the same unique index
--     (guard 1, docs/13-migration.md §2).
--
-- ## Why the idempotency key is stored, and not derived per pass
--
-- The reconciler derives its keys from `(runId, operation, subject)`
-- (packages/connectors/src/write/idempotency.ts) because one of its writes is
-- one pass's decision: a later pass deciding the same thing again must carry a
-- *different* key, or the tool discards it as a duplicate and prisme silently
-- stops converging.
--
-- A creation intent is the opposite case. It is **one logical write that
-- outlives a pass**: the object should exist exactly once, however many passes
-- it takes to confirm that it does. So the key is generated once, stored in the
-- row before anything is sent, and reused on every retry forever. That is what
-- closes the window this whole table exists for — the writer succeeded, the
-- process died before recording the id, and the next pass sends the same
-- command again. The tool recognises the key and creates nothing.
--
-- ## What is deliberately absent
--
-- No `deleted` state and no delete. prisme never destroys an external object
-- (docs/11-ownership.md §4), so an intent that turns out to be unwanted is
-- abandoned — `failed` with a reason — and the object it may have created is
-- adopted or ignored through the queue like any other. A creation ledger with a
-- rollback would be the one code path in this repository able to remove
-- somebody's real work.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS creation_intent;
--   DROP TABLE IF EXISTS capture;
--   DELETE FROM prisme_migration WHERE version = '0007';
-- Reversing this discards pending intentions and the captures prisme recorded.
-- The external objects already created survive, unlinked — they become
-- adoption-queue candidates, which is the designed way back in and is why
-- nothing here is unrecoverable.

-- ---------------------------------------------------------------------------
-- Capture — a small thing, which stays a task
-- ---------------------------------------------------------------------------

CREATE TABLE capture (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- prisme owns this: a capture's title is what the person typed into prisme,
  -- and it is the content prisme writes outward (docs/11-ownership.md §4).
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  area_key         text NOT NULL REFERENCES area (key) ON DELETE RESTRICT,
  -- Where the capture is to live, resolved from `area_mapping` at capture time
  -- and stored, because the intent must survive a mapping being re-pointed.
  external_project_id text,
  external_section_id text,
  -- The task, once the converge pass has confirmed it. Bound in
  -- entity_external_ref too, which is where guard 1 refuses a second binding.
  external_task_id text,
  -- Set when this capture became an initiative. The initiative **reuses the
  -- capture's task** as its anchor, so promotion creates nothing: see below.
  promoted_to      uuid REFERENCES initiative (id) ON DELETE SET NULL,
  promoted_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_says_when CHECK ((promoted_to IS NULL) = (promoted_at IS NULL))
);

COMMENT ON TABLE capture IS
  'A small thing, captured in seconds with its decisions deferred. It stays a task: promoting it is a separate, deliberate act, and most captures never are.';

COMMENT ON COLUMN capture.promoted_to IS
  'Promotion moves the capture''s task to the new initiative as its anchor — it does not create a second one. The mechanism is ADR-0010 guard 2: the initiative is written with external_anchor_id already set, so the planner is structurally incapable of emitting a create for it.';

-- One capture per initiative. Two captures claiming to have become the same
-- initiative would make "which task is the anchor" a question with two answers.
CREATE UNIQUE INDEX capture_promotes_to_one_initiative
  ON capture (promoted_to) WHERE promoted_to IS NOT NULL;

CREATE INDEX capture_unpromoted ON capture (created_at) WHERE promoted_to IS NULL;

-- ---------------------------------------------------------------------------
-- The creation ledger
-- ---------------------------------------------------------------------------

CREATE TABLE creation_intent (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind     text NOT NULL CHECK (entity_kind IN ('capture', 'initiative', 'project')),
  entity_id       uuid NOT NULL,
  tool            text NOT NULL CHECK (tool IN ('task', 'document')),
  object_kind     text NOT NULL CHECK (object_kind IN ('task', 'project', 'section', 'page')),
  -- A project's sections are ordered and a section's position is part of what
  -- makes it that section rather than another with the same name. Everything
  -- else uses 0, which is what makes the uniqueness below mean "one per slot".
  ordinal         integer NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  -- What to create, as prisme decided it: prisme-owned values only. It carries
  -- instance data (a title, a location) and never leaves this database.
  draft           jsonb NOT NULL,
  -- Generated once, before the first attempt, and reused on every retry. See
  -- the header: this is the difference between this ledger and the
  -- reconciler's per-pass keys, and it is the whole anti-duplicate mechanism.
  idempotency_key uuid NOT NULL,
  state           text NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending', 'satisfied', 'failed')),
  external_id     text,
  -- A section cannot be created before the project that holds it. Modelled as
  -- an edge rather than as an ordering convention, so the converge pass refuses
  -- to run a step whose prerequisite is unsatisfied instead of guessing.
  requires        uuid REFERENCES creation_intent (id) ON DELETE CASCADE,
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Why the last attempt failed, in prisme's words. Never the tool's prose: it
  -- quotes the object's own content back (packages/connectors/src/errors.ts).
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- A satisfied intent must say what it made. Without this, "done" and "we lost
  -- the id" are the same row, and the second one is an orphan.
  CONSTRAINT satisfied_intents_name_what_they_made
    CHECK (state <> 'satisfied' OR external_id IS NOT NULL),
  CONSTRAINT failures_say_why
    CHECK (state <> 'failed' OR last_error IS NOT NULL)
);

COMMENT ON TABLE creation_intent IS
  'What prisme has decided should exist outward and has not yet confirmed does. Written and committed before anything is sent, which is what makes a creation interrupted mid-way a resumable row rather than an orphan in one tool.';

COMMENT ON COLUMN creation_intent.idempotency_key IS
  'Stored, not derived per pass. A creation is one logical write that outlives a pass, so every retry carries the same key forever and the tool recognises the second send as the first.';

COMMENT ON COLUMN creation_intent.draft IS
  'Instance data: a real title and a real external location. It lives in this database and never in the repository (docs/17-privacy.md).';

-- The no-duplicate guard at the intent level: asking twice for the same object
-- updates one row rather than enqueueing a second creation. This is guard 2's
-- shape (ADR-0010) applied to the objects the planner does not decide from an
-- entity's own fields — a page is optional, so `external_page_id IS NULL`
-- cannot mean "wants one".
CREATE UNIQUE INDEX creation_intent_one_per_slot
  ON creation_intent (entity_kind, entity_id, object_kind, ordinal);

-- A satisfied intent has bound its object in entity_external_ref, where the
-- unique index refuses a second binding. Two intents claiming the same external
-- object would be two entities claiming it, so refuse it here too and get the
-- clearer error of the pair.
CREATE UNIQUE INDEX creation_intent_produced_once
  ON creation_intent (object_kind, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX creation_intent_outstanding
  ON creation_intent (state, created_at) WHERE state <> 'satisfied';

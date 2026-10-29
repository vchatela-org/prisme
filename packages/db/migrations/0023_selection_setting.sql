-- 0023 · the work-in-progress limits, chosen on the Settings screen
--
-- ADR-0036, which closes OQ-2. Until this migration the limits were a constant
-- in packages/domain — one `now` per area and five overall — named as a
-- candidate for the first review to calibrate, and changing them meant a
-- release. They are a personal calibration, and a soft one: work blocked by
-- someone else moves to `waiting` and frees its slot, and the caps only stop
-- selection *proposing* more, so they belong where the owner can move them.
--
-- A singleton the application upserts, like `audit_setting`: no row means
-- nothing has been chosen, and the defaults apply (`DEFAULT_SELECTION_LIMITS`
-- in packages/domain, which is also where the bounds below come from). The
-- bounds are repeated as CHECKs so the database refuses a pair the domain
-- would.
--
-- Additive and forward-only; no backfill, and no GRANT beyond the default
-- privileges the migration role already gives the application role.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS selection_setting;
--   DELETE FROM prisme_migration WHERE version = '0023';
-- Reversing it loses the chosen limits and nothing else: the defaults apply
-- again, and no other table reads this one.

CREATE TABLE selection_setting (
  id                text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  max_now           integer NOT NULL CHECK (max_now BETWEEN 1 AND 30),
  max_now_per_area  integer NOT NULL CHECK (max_now_per_area BETWEEN 1 AND 10),
  updated_at        timestamptz NOT NULL,
  CHECK (max_now_per_area <= max_now)
);

COMMENT ON TABLE selection_setting IS
  'One row, upserted from the Settings screen. No row: DEFAULT_SELECTION_LIMITS in packages/domain applies (ADR-0036).';

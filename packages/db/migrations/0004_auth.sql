-- 0004 · what authentication has to remember
--
-- Three tables, and they are here together because each is a security decision
-- that has to survive a restart. A token minted into a process's memory is a
-- token the next rollout silently revokes; a confirmation held in memory is one
-- two replicas disagree about; a kill switch that forgets it was pulled is not
-- a kill switch.
--
-- Nothing here stores a credential in a form that reading this database would
-- reveal. The API token keeps an Argon2id hash, peppered with TOKEN_PEPPER,
-- which is not in the database — so a dump alone is not a set of credentials
-- (docs/14-threat-model.md §3). The confirmation keeps a SHA-256 fingerprint,
-- which is sufficient for a 256-bit secret with a two-minute life and is not
-- worth an Argon2 verification on a path an agent calls in a loop.
--
-- There is deliberately **no human session table**. ADR-0021 rule 5: prisme
-- issues no session cookie, so there is no prisme session to steal, fixate or
-- forget to invalidate. Logout belongs to the identity provider.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS confirmation_token;
--   DROP TABLE IF EXISTS api_token;
--   DROP TABLE IF EXISTS write_switch;
--   DELETE FROM prisme_migration WHERE version = '0004';
-- Rehearsed against a throwaway database, never against the live one. Note that
-- reversing this revokes every issued token by deleting it, which is the
-- correct behaviour and not a side effect to be worked around.

-- ---------------------------------------------------------------------------
-- Scoped API tokens for machines (ADR-0015, docs/14-threat-model.md §3)
-- ---------------------------------------------------------------------------

CREATE TABLE api_token (
  -- The public half of the credential: 96 bits, in clear, and the lookup key.
  -- Without it, authenticating means Argon2-verifying against every row until
  -- one matches — a cost linear in the number of tokens that any caller can
  -- trigger at will.
  id           text PRIMARY KEY CHECK (length(id) = 16),
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  -- text[] rather than jsonb, on W05's evidence: a jsonb column arrived at the
  -- driver as text, and every property access on it silently yielded undefined.
  -- An array of short identifiers is what this is, so it is stored as one.
  scopes       text[] NOT NULL CHECK (cardinality(scopes) > 0),
  -- Argon2id. The constraint is a shape check, not a security control — it is
  -- here so that a future code path that "temporarily" wrote a SHA-256 digest
  -- would fail to insert rather than quietly weaken every stored credential.
  hash         text NOT NULL CHECK (hash LIKE '$argon2id$%'),
  created_at   timestamptz NOT NULL,
  -- The sub of the human who minted it. Minting is an authenticated act, and
  -- this is the first link in the chain an audit follows.
  created_by   text NOT NULL,
  -- NOT NULL, and that is the control. "Expiring by default" only means
  -- something if the schema has no way to spell "never".
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  CHECK (expires_at > created_at)
);

COMMENT ON TABLE api_token IS
  'Argon2id at rest, peppered with a secret that is not in this database. The plaintext is displayed exactly once, at creation, and never stored.';

COMMENT ON COLUMN api_token.scopes IS
  'No wildcard exists. A read-scoped token cannot reach a write endpoint because it does not hold the scope that endpoint declares.';

COMMENT ON COLUMN api_token.last_used_at IS
  'Written best-effort and off the request path: a stale value is a reporting inaccuracy, a failed write that refuses a valid request is an outage.';

-- The only query the request path makes is by primary key, so no index is
-- needed for it. This one serves the management screen, which lists live
-- tokens and is the thing that makes a stale token visible.
CREATE INDEX api_token_live ON api_token (created_at DESC) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Diff-bound confirmations for the MCP write path (W14 item 4; W06 consumes it)
-- ---------------------------------------------------------------------------

CREATE TABLE confirmation_token (
  id          text PRIMARY KEY CHECK (length(id) = 16),
  fingerprint text NOT NULL,
  -- The hash of the exact diff this authorises, and the entire point of the
  -- table. A confirmation bound to a session, an operation name or a request id
  -- would authorise "whatever apply does next", which is a round trip rather
  -- than a control (apps/api/CLAUDE.md, the MCP surface).
  diff_hash   text NOT NULL,
  operation   text NOT NULL,
  -- Executed by the principal that planned it. A confirmation is not a
  -- capability that can be handed to another caller.
  subject     text NOT NULL,
  issued_at   timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  -- Set on any use *attempt*, including one that then fails on a stale diff.
  -- A confirmation that survives a failed use is a brute-force budget.
  consumed_at timestamptz,
  CHECK (expires_at > issued_at)
);

COMMENT ON TABLE confirmation_token IS
  'Short-lived, single-use, and bound to the diff it authorises. Rejected if state has moved, because a replanned diff hashes differently.';

CREATE INDEX confirmation_token_expiry ON confirmation_token (expires_at);

-- ---------------------------------------------------------------------------
-- The kill switch (W14 item 10)
-- ---------------------------------------------------------------------------

CREATE TABLE write_switch (
  -- One row, the same way sync_cursor is one row: a second switch would mean
  -- two answers to "are writes frozen", and the process would alternate.
  id         text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  engaged    boolean NOT NULL DEFAULT false,
  mode       text NOT NULL DEFAULT 'outward' CHECK (mode IN ('outward', 'all')),
  changed_at timestamptz,
  changed_by text,
  reason     text
);

COMMENT ON TABLE write_switch IS
  'Strictly subtractive. It withholds scopes from every principal; it can never grant a write the deployment has not already enabled through SYNC_WRITE_ENABLED.';

INSERT INTO write_switch (id) VALUES ('singleton');

-- One row per guest account. The raw token is never stored, only its SHA-256 hash.
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  state         TEXT NOT NULL,            -- JSON GameState
  pending       TEXT,                     -- JSON PendingBattle or NULL
  version       INTEGER NOT NULL DEFAULT 0, -- incremented on every write (optimistic lock)
  last_cid      TEXT,                     -- last applied client action id (idempotent retries)
  last_response TEXT,                     -- JSON response that was returned for last_cid
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 0049: Per-client MCP workspaces — tenant tokens, publish limits, kill switch.
-- Additive only.

CREATE TABLE IF NOT EXISTS client_mcp_tokens (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,             -- SHA-256 hex of the raw token
  token_prefix TEXT NOT NULL,             -- first 8 chars for display
  label        TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER,
  expires_at   INTEGER,
  revoked_at   INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_mcp_token_hash ON client_mcp_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_client_mcp_tokens_client ON client_mcp_tokens(client_id, active);

CREATE TABLE IF NOT EXISTS client_mcp_limits (
  client_id            TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  social_per_day       INTEGER NOT NULL DEFAULT 10,
  per_platform_per_day INTEGER NOT NULL DEFAULT 3,
  blog_per_day         INTEGER NOT NULL DEFAULT 2,
  gbp_per_day          INTEGER NOT NULL DEFAULT 5,
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
);

ALTER TABLE clients ADD COLUMN mcp_enabled INTEGER NOT NULL DEFAULT 0;

-- Migration 0040: Discord Context Memory
-- Stores numbered item lists for Discord reference resolution

CREATE TABLE IF NOT EXISTS discord_context_memory (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  discord_user_id TEXT NOT NULL,
  discord_channel_id TEXT,
  -- NULL = DM, otherwise guild channel ID
  numbered_items  TEXT NOT NULL,
  -- JSON array of {id, title, client, status, ...} for number references
  context_type    TEXT DEFAULT 'post_list',
  -- e.g., "post_list", "approval_queue", "search_results"
  expires_at      INTEGER NOT NULL,
  -- Unix timestamp when this context becomes invalid
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_discord_context_memory_user_expires ON discord_context_memory(discord_user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_discord_context_memory_channel_type ON discord_context_memory(discord_channel_id, context_type);

-- Cleanup old context records regularly
-- DELETE FROM discord_context_memory WHERE expires_at < unixepoch()

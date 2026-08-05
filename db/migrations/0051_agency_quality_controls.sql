-- 0051: Enforce current-version editorial review and persist backend cooldowns.

ALTER TABLE content_review_notes ADD COLUMN post_updated_at INTEGER;
ALTER TABLE content_review_notes ADD COLUMN content_hash TEXT;
ALTER TABLE content_review_notes ADD COLUMN disposition TEXT NOT NULL DEFAULT 'reviewed';

CREATE INDEX IF NOT EXISTS idx_content_review_notes_current
  ON content_review_notes(post_id, content_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS agency_backend_health (
  backend         TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'healthy',
  failure_count   INTEGER NOT NULL DEFAULT 0,
  last_failure_at INTEGER,
  cooldown_until  INTEGER,
  last_error      TEXT,
  last_success_at INTEGER,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_agency_backend_cooldown
  ON agency_backend_health(cooldown_until);

UPDATE agent_definitions
SET backend_priority = '["hermes","codex","openai"]', updated_at = unixepoch()
WHERE slug = 'gmb-rank' AND backend_priority IS NULL;

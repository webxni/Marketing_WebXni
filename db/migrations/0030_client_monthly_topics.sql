-- Migration 0030: client monthly topic plans
-- Separate month-scoped topic planning from long-term client intelligence.

CREATE TABLE IF NOT EXISTS client_monthly_topics (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id               TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan_month              TEXT NOT NULL, -- YYYY-MM
  topic_title             TEXT NOT NULL,
  service_category        TEXT,
  target_keyword          TEXT,
  content_type_preference TEXT,          -- 'image'|'reel'|'video'|'blog' or NULL
  preferred_platforms     TEXT,          -- JSON array or NULL
  priority                INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'planned', -- 'planned'|'used'|'skipped'
  notes                   TEXT,
  used_post_id            TEXT,
  created_by              TEXT,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  used_at                 INTEGER
);

CREATE INDEX IF NOT EXISTS idx_client_monthly_topics_client_month
  ON client_monthly_topics(client_id, plan_month, status, priority DESC, created_at ASC);

-- Migration 0026: recurring content requests + per-client topic queue
-- Enables flexible autonomous content operations:
--   • "Post every Monday at 9am for Golden Touch Roofing"
--   • "Create 10 blog posts for Elite Team Builders from this topic list"
--   • "Weekdays at 8am, generate one social post using the next pending topic"
--
-- content_requests: recurring content schedules (separate from GBP offers/events
--                   which only handle Google Business Profile).
-- client_topics:    backlog of topic strings per client, consumed by recurring
--                   schedules (or batch_create_content) in priority order.
--
-- Run: wrangler d1 execute webxni-db --file=db/migrations/0026_content_requests_topics.sql --remote

CREATE TABLE IF NOT EXISTS content_requests (
  id                TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id         TEXT    NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  request_type      TEXT    NOT NULL DEFAULT 'social',  -- 'social'|'blog'|'mixed'
  content_type      TEXT,                               -- 'image'|'reel'|'video'|'blog'; NULL picks per request_type
  platforms         TEXT,                               -- JSON array; NULL = all client platforms
  recurrence        TEXT    NOT NULL DEFAULT 'weekly',  -- 'daily'|'weekdays'|'weekly'|'biweekly'|'monthly'|'once'
  day_of_week       INTEGER,                            -- 0=Sun..6=Sat (weekly/biweekly)
  time_of_day       TEXT,                               -- HH:MM UTC (optional hour gate)
  per_run           INTEGER NOT NULL DEFAULT 1,         -- posts per firing (1-10)
  topic_strategy    TEXT    NOT NULL DEFAULT 'queue',   -- 'queue'|'auto'|'fixed'
  fixed_topic       TEXT,                               -- used when topic_strategy='fixed'
  next_run_date     TEXT,                               -- YYYY-MM-DD next eligible firing
  last_triggered_at TEXT,                               -- YYYY-MM-DD last firing (dedup)
  active            INTEGER NOT NULL DEFAULT 1,
  paused            INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  created_by        TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_content_requests_next_run ON content_requests(next_run_date, active, paused);
CREATE INDEX IF NOT EXISTS idx_content_requests_client   ON content_requests(client_id);

CREATE TABLE IF NOT EXISTS client_topics (
  id           TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id    TEXT    NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  topic        TEXT    NOT NULL,
  content_type TEXT,                                    -- 'image'|'blog'|'reel'|'video' or NULL = any
  platforms    TEXT,                                    -- JSON array or NULL
  target_date  TEXT,                                    -- optional YYYY-MM-DD hint
  priority     INTEGER NOT NULL DEFAULT 0,              -- higher = consumed first
  status       TEXT    NOT NULL DEFAULT 'pending',      -- 'pending'|'used'|'skipped'
  used_post_id TEXT,                                    -- set when consumed
  notes        TEXT,
  created_by   TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  used_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_client_topics_client_status ON client_topics(client_id, status, priority DESC);

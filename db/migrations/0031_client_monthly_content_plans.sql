-- Migration 0031: client monthly content plans
-- Adds month-scoped plan metadata and links monthly topics to that plan/post.

CREATE TABLE IF NOT EXISTS client_monthly_content_plans (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id        TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan_month       TEXT NOT NULL, -- YYYY-MM
  monthly_focus    TEXT,
  promotion_notes  TEXT,
  priority_services TEXT,
  notes            TEXT,
  created_by       TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (client_id, plan_month)
);

ALTER TABLE client_monthly_topics ADD COLUMN plan_id TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN generated_post_id TEXT;

CREATE INDEX IF NOT EXISTS idx_client_monthly_content_plans_client_month
  ON client_monthly_content_plans(client_id, plan_month);

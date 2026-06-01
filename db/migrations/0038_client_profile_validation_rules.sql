-- Migration 0038: Client Profile Validation Rules
-- Adds strict validation policies per client for content generation

CREATE TABLE IF NOT EXISTS client_profile_validation_rules (
  client_id                     TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  industry_strict_mode          INTEGER NOT NULL DEFAULT 1,
  -- 1 = block content if topic doesn't match industry
  allowed_service_categories    TEXT,
  -- JSON array of allowed service categories
  -- e.g., ["lock_service", "installation"] for locksmith
  forbidden_service_categories  TEXT,
  -- JSON array of forbidden service categories
  -- e.g., ["remodeling", "construction"] for locksmith
  allowed_content_types         TEXT,
  -- JSON array of allowed content types: image, reel, video, blog
  forbidden_content_types       TEXT,
  -- JSON array of forbidden content types
  -- e.g. blogs-only package: forbidden=["reel", "video"]
  forbidden_topics              TEXT,
  -- JSON array of topic phrases to block
  -- e.g., ["kitchen remodel", "bathroom renovation"] for locksmith
  allowed_package_limit_monthly INTEGER,
  -- NULL = no limit, or specific limit for this client
  require_geographic_mention    INTEGER NOT NULL DEFAULT 0,
  -- 1 = all content must mention at least one service area
  require_service_mention       INTEGER NOT NULL DEFAULT 0,
  -- 1 = all content must mention at least one service offered
  created_at                    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_client_profile_validation_rules_client ON client_profile_validation_rules(client_id);

-- Seed with safe defaults for all clients
INSERT OR IGNORE INTO client_profile_validation_rules
  (client_id, industry_strict_mode, allowed_content_types)
SELECT id, 1, '["image","reel","video","blog"]'
FROM clients
WHERE id NOT IN (SELECT client_id FROM client_profile_validation_rules);
